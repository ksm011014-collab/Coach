const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

async function main() {
  const argumentsMap = {};
  for (let index=2;index<process.argv.length;index+=2) argumentsMap[process.argv[index]]=process.argv[index+1];
  const videoPath = argumentsMap['--video'] && path.resolve(argumentsMap['--video']);
  const synthetic = argumentsMap['--synthetic']==='true';
  const outputPath = argumentsMap['--output'] && path.resolve(argumentsMap['--output']);
  const clipId = argumentsMap['--clip-id'];
  const stance = argumentsMap['--stance'] || 'orthodox';
  if ((!videoPath && !synthetic) || !outputPath || !clipId || !['orthodox','southpaw'].includes(stance)) throw new Error('Required: --video path (or --synthetic true) --output path --clip-id id --stance orthodox|southpaw');
  if (videoPath && synthetic) throw new Error('Choose video or synthetic input');
  if (fs.existsSync(outputPath)) throw new Error('Output already exists; choose a new output path');
  const root = path.resolve(__dirname,'../web');
  const server = http.createServer((request,response)=>{
    const pathname = new URL(request.url,'http://localhost').pathname;
    if (pathname==='/') { response.setHeader('Content-Type','text/html'); return response.end('<!doctype html><input type="file"><video muted playsinline width="640" height="480"></video><output></output>'); }
    const file = path.resolve(root,pathname.slice(1));
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin);
    if (videoPath) await page.locator('input').setInputFiles(videoPath);
    const result = await page.evaluate(async ({synthetic,stance,delegate})=>{
      const [{MotionPipeline},{MotionRound},{poseFeatures}] = await Promise.all([import('/scripts/motion-pipeline.mjs'),import('/scripts/motion-round.mjs'),import('/scripts/motion-features.mjs')]);
      const video = document.querySelector('video');
      let inputBlob = document.querySelector('input').files[0];
      if (synthetic) {
        const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=480;
        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream,{mimeType:'video/webm'});
        const chunks=[];
        recorder.ondataavailable=event=>chunks.push(event.data);
        const stopped=new Promise(resolve=>recorder.onstop=resolve);
        recorder.start();
        const started=performance.now();
        while(performance.now()-started<3000) {
          canvas.getContext('2d').fillStyle='#123456'; canvas.getContext('2d').fillRect(0,0,640,480);
          await new Promise(resolve=>setTimeout(resolve,33));
        }
        recorder.stop(); await stopped; stream.getTracks().forEach(track=>track.stop());
        inputBlob=new Blob(chunks,{type:'video/webm'});
      }
      const objectUrl=URL.createObjectURL(inputBlob);
      video.src=objectUrl;
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Video decoding failed'));});
      const config = await (await fetch('/vendor/motion/manifest.json')).json();
      if (delegate) config.delegate=delegate;
      const round = new MotionRound({startedAt:0,stance});
      const inference=[]; const transport=[]; const publications=[];
      let presented=0; let valid=0; let failure; let frameHandle; let animationHandle; let ticks=0; let frameTimestamp=0;
      const pipeline = new MotionPipeline({workerFactory:()=>new Worker('/scripts/motion-worker.js'),
        capture:source=>createImageBitmap(source,{resizeWidth:Math.min(source.videoWidth,640),resizeHeight:Math.max(1,Math.round(source.videoHeight*Math.min(source.videoWidth,640)/source.videoWidth))}),
        onResult:result=>{
          const features=poseFeatures(result); if(features.valid) valid++;
          const before=round.events.length; round.update(features);
          inference.push(result.inferenceMs);transport.push(result.latencyMs);
          document.querySelector('output').textContent=String(round.totalPoints);
          for (const event of round.events.slice(before)) publications.push({id:event.id,published_ms:Math.round(video.currentTime*1000),completion_to_score_ms:Math.max(0,video.currentTime*1000-event.end_ms)});
        },onError:error=>{failure=error.message;}});
      try {
        pipeline.start(config);
        const preparing=performance.now();
        while(!pipeline.ready && !failure && performance.now()-preparing<31000) await new Promise(resolve=>setTimeout(resolve,25));
        if (!pipeline.ready || failure) throw new Error(failure||'Model preparation timed out');
        const playbackStarted=performance.now();
        const frame=(_,metadata)=>{
          presented++; frameTimestamp=metadata.mediaTime*1000;
          if (frameTimestamp>0) pipeline.submit(video,frameTimestamp);
          frameHandle=video.requestVideoFrameCallback(frame);
        };
        const tick=()=>{ticks++;animationHandle=requestAnimationFrame(tick);};
        frameHandle=video.requestVideoFrameCallback(frame); tick();
        await video.play();
        while(!video.ended && !failure && performance.now()-playbackStarted<610000) await new Promise(resolve=>setTimeout(resolve,25));
        if (failure || !video.ended) throw new Error(failure||'Video exceeds 10 minute evaluation limit');
        const playbackMs=performance.now()-playbackStarted;
        const draining=performance.now();
        while(pipeline.pending && !failure && performance.now()-draining<5500) await new Promise(resolve=>setTimeout(resolve,10));
        if(failure || pipeline.pending) throw new Error(failure||'Final frame timed out');
        const duration=Math.max(frameTimestamp,video.currentTime*1000);
        const report=round.finish(duration);
        const percentile=(values,fraction)=>{const sorted=[...values].sort((left,right)=>left-right);return sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]:null;};
        return {events:report.events,duration_ms:Math.floor(duration),stance,model:config.model,delegate:config.delegate,model_sha256:config.sha256,
          workload:synthetic?'synthetic blank video; not human accuracy':'local video real-time replay; not live camera or concurrent recording',
          performance:{playback_ms:playbackMs,presented_frames:presented,analysis_frames:inference.length,valid_pose_frames:valid,
            presentation_fps:presented*1000/playbackMs,analysis_fps:inference.length*1000/playbackMs,animation_fps:ticks*1000/playbackMs,
            inference_median_ms:percentile(inference,.5),inference_p95_ms:percentile(inference,.95),transport_p95_ms:percentile(transport,.95)},
          score_publications:publications,finalized_on_end_ids:report.events.filter(event=>!publications.some(publication=>publication.id===event.id)).map(event=>event.id)};
      } finally {pipeline.stop();video.pause();video.cancelVideoFrameCallback(frameHandle);cancelAnimationFrame(animationHandle);URL.revokeObjectURL(objectUrl);}
    },{synthetic,stance,delegate:argumentsMap['--delegate']});
    result.clip_id=clipId;
    if(videoPath) result.input_sha256=crypto.createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
    process.stdout.write(JSON.stringify({clip_id:clipId,events:result.events.length,workload:result.workload,performance:result.performance})+'\n');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}

main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
