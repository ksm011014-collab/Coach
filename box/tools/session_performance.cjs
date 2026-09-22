const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

async function processResources(browserSession) {
  const processes=(await browserSession.send('SystemInfo.getProcessInfo')).processInfo;
  const ids=processes.map(process=>Number(process.id)).filter(identifier=>Number.isSafeInteger(identifier) && identifier>0);
  const result={cpuSeconds:processes.reduce((total,process)=>total+process.cpuTime,0),processCount:ids.length};
  if (process.platform!=='win32' || !ids.length) return result;
  try {
    const command=`$taskIds=@(${ids.join(',')}); $taskProcesses=Get-Process -Id $taskIds -ErrorAction SilentlyContinue; $taskEngines=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -match '^pid_(\\d+)_' -and $taskIds -contains [int]$Matches[1] }); [pscustomobject]@{privateBytes=($taskProcesses | Measure-Object PrivateMemorySize64 -Sum).Sum; workingSetBytes=($taskProcesses | Measure-Object WorkingSet64 -Sum).Sum; gpuEngineSamples=@($taskEngines | Select-Object Name,UtilizationPercentage)} | ConvertTo-Json -Depth 4 -Compress`;
    Object.assign(result,JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,timeout:8000,stdio:['ignore','pipe','pipe']})));
  } catch (_) { result.windowsCounters='unavailable'; }
  return result;
}

async function installProbe(page) {
  await page.addInitScript(() => {
    const originalCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if (!constraints.video || constraints.audio) return originalCapture(constraints);
      const canvas=document.createElement('canvas');
      canvas.width=640; canvas.height=360;
      const context=canvas.getContext('2d');
      let tick=0;
      const draw=()=>{context.fillStyle='#182331';context.fillRect(0,0,640,360);context.fillStyle='#445566';context.fillRect(tick++%600,160,20,20);};
      draw();
      const timer=setInterval(draw,1000/30);
      const stream=canvas.captureStream(30);
      const track=stream.getVideoTracks()[0];
      const stop=track.stop.bind(track);
      track.stop=()=>{clearInterval(timer);stop();};
      return stream;
    };
    window.motionMeasurements = {results:[],errors:[]};
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        if (!String(args[0]).includes('motion-worker')) return;
        this.addEventListener('message', ({data}) => {
          if (data.type==='result') window.motionMeasurements.results.push({at:performance.now(),inferenceMs:data.inferenceMs,latencyMs:performance.now()-data.timestamp});
          if (data.type==='error') window.motionMeasurements.errors.push(data.message);
        });
      }
    };
  });
}

async function measureSession(page, seconds, output) {
  if (!Number.isInteger(seconds) || seconds<10 || seconds>900) throw new Error('Performance duration must be 10..900 seconds');
  const cdp = await page.context().newCDPSession(page);
  const browserSession=await page.context().browser().newBrowserCDPSession();
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    window.motionMeasurements.results=[];
    window.motionMeasurements.started=performance.now();
    window.motionMeasurements.frames=0;
    const video=document.querySelector('#cameraPreview');
    const tick=()=>{window.motionMeasurements.frames++;window.motionMeasurements.callback=video.requestVideoFrameCallback(tick);};
    window.motionMeasurements.callback=video.requestVideoFrameCallback(tick);
  });
  const samples=[];
  try {
    for (let elapsed=0;elapsed<seconds;elapsed+=10) {
      await page.waitForTimeout(Math.min(10,seconds-elapsed)*1000);
      const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
      const sample=await page.evaluate(()=>({elapsedMs:performance.now()-window.motionMeasurements.started,frames:window.motionMeasurements.frames,results:window.motionMeasurements.results.length,recording:state.recorder?.state,bytes:state.recordedChunks.reduce((total,chunk)=>total+chunk.size,0),status:document.querySelector('#motionStatus').textContent}));
      const resources=await processResources(browserSession);
      samples.push({...sample,rendererTaskSeconds:metrics.TaskDuration,rendererJsHeapBytes:metrics.JSHeapUsedSize,resources});
      process.stdout.write(JSON.stringify({performanceSample:samples.at(-1)})+'\n');
    }
    const data=await page.evaluate(()=>{
      document.querySelector('#cameraPreview').cancelVideoFrameCallback(window.motionMeasurements.callback);
      return {results:window.motionMeasurements.results,errors:window.motionMeasurements.errors};
    });
    const percentile=(values,ratio)=>values.length?values.sort((left,right)=>left-right)[Math.min(values.length-1,Math.floor(values.length*ratio))]:null;
    const analysisEnabled=process.env.BOXING_COACH_TEST_DISABLE_MOTION!=='1';
    const result={workload:'Generated live canvas stream, real application recording; not physical camera or human accuracy measurement',analysisEnabled,seconds,samples,errors:data.errors,
      inferenceMedianMs:percentile(data.results.map(row=>row.inferenceMs),0.5),inferenceP95Ms:percentile(data.results.map(row=>row.inferenceMs),0.95),
      resultLatencyP95Ms:percentile(data.results.map(row=>row.latencyMs),0.95),
      limitations:'CPU seconds and Windows memory include this browser process group, not the Python server. GPU counters are per-engine samples, not total device utilization; sums may exceed 100. Counter collection adds overhead. Camera callbacks do not prove recording playback.'};
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});
    if (data.errors.length || (analysisEnabled && !data.results.length) || samples.some(sample=>sample.recording!=='recording')) throw new Error('Concurrent recording/analysis did not stay active; inspect performance artifact');
  } finally { await cdp.detach(); await browserSession.detach(); }
}

module.exports={installProbe,measureSession};
