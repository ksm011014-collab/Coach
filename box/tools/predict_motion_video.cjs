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
  const offlineFps = Number(argumentsMap['--offline-fps'] || 0);
  const dispatch = argumentsMap['--dispatch'] || 'latest';
  const inputWidth = Number(argumentsMap['--input-width'] || 640);
  const modelFile = argumentsMap['--model-file'] && path.resolve(argumentsMap['--model-file']);
  const modelHash = modelFile && crypto.createHash('sha256').update(fs.readFileSync(modelFile)).digest('hex');
  if (!Number.isInteger(inputWidth) || inputWidth < 128 || inputWidth > 1920) throw new Error('Input width must be an integer between 128 and 1920');
  if (!['latest','drop'].includes(dispatch)) throw new Error('Dispatch must be latest or drop');
  if (!Number.isFinite(offlineFps) || offlineFps < 0 || offlineFps > 120) throw new Error('Offline sampling FPS must be between 0 and 120');
  if ((!videoPath && !synthetic) || !outputPath || !clipId || !['orthodox','southpaw'].includes(stance)) throw new Error('Required: --video path (or --synthetic true) --output path --clip-id id --stance orthodox|southpaw');
  if (videoPath && synthetic) throw new Error('Choose video or synthetic input');
  if (fs.existsSync(outputPath)) throw new Error('Output already exists; choose a new output path');
  const root = path.resolve(__dirname,'../web');
  const server = http.createServer((request,response)=>{
    const pathname = new URL(request.url,'http://localhost').pathname;
    if (pathname === '/evaluation-model.task' && modelFile) {
      response.setHeader('Content-Type','application/octet-stream');
      return fs.createReadStream(modelFile).pipe(response);
    }
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
    const result = await page.evaluate(async ({synthetic,stance,delegate,diagnostics,offlineFps,dispatch,inputWidth,modelHash})=>{
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
      if (modelHash) { config.modelPath='/evaluation-model.task'; config.sha256=modelHash; }
      if (delegate) config.delegate=delegate;
      const round = new MotionRound({startedAt:0,stance});
      const inference=[]; const transport=[]; const publications=[];
      const invalidReasons={}; const featureFrames=[]; const poseFrames=[]; const captureTimes=[]; const postprocessTimes=[];
      const preprocessTimes=[]; const preparationTimes=[]; const deliveryTimes=[]; const frameAges=[]; const animationDelays=[];
      let presented=0; let valid=0; let failure; let frameHandle; let animationHandle; let ticks=0; let frameTimestamp=0;
      const pipeline = new MotionPipeline({workerFactory:()=>new Worker('/scripts/motion-worker.js'),intervalMs:offlineFps?0:40,
        capture:async source=>{
          const started=performance.now();
          const bitmap=await createImageBitmap(source,{resizeWidth:Math.min(source.videoWidth,inputWidth),resizeHeight:Math.max(1,Math.round(source.videoHeight*Math.min(source.videoWidth,inputWidth)/source.videoWidth))});
          captureTimes.push(performance.now()-started);
          return bitmap;
        },
        onResult:result=>{
          const started=performance.now();
          const features=poseFeatures(result); if(features.valid) valid++;
          else invalidReasons[features.reason]=(invalidReasons[features.reason]||0)+1;
          if(diagnostics) {
            featureFrames.push(features);
            poseFrames.push({timestamp:result.timestamp,model:result.model,width:result.width,height:result.height,multiplePeopleCheck:result.multiplePeopleCheck,poses:result.poses});
          }
          const before=round.events.length; round.update(features);
          inference.push(result.inferenceMs);transport.push(result.latencyMs);
          preprocessTimes.push(result.preprocessMs); preparationTimes.push(result.resultPreparationMs);
          deliveryTimes.push(Math.max(0,result.latencyMs-result.captureMs-result.preprocessMs-result.inferenceMs-result.resultPreparationMs));
          if(!offlineFps) frameAges.push(Math.max(0,video.currentTime*1000-result.timestamp));
          document.querySelector('output').textContent=String(round.totalPoints);
          for (const event of round.events.slice(before)) publications.push({id:event.id,published_ms:Math.round(video.currentTime*1000),completion_to_score_ms:Math.max(0,video.currentTime*1000-event.end_ms)});
          postprocessTimes.push(performance.now()-started);
          requestAnimationFrame(()=>animationDelays.push(performance.now()-started));
        },onError:error=>{failure=error.message;}});
      try {
        pipeline.start(config);
        const preparing=performance.now();
        while(!pipeline.ready && !failure && performance.now()-preparing<65000) await new Promise(resolve=>setTimeout(resolve,25));
        if (!pipeline.ready || failure) throw new Error(failure||'Model preparation timed out');
        const playbackStarted=performance.now();
        const frame=(_,metadata)=>{
          presented++; frameTimestamp=metadata.mediaTime*1000;
          if (frameTimestamp>0) dispatch==='latest'?pipeline.offer(video,frameTimestamp):pipeline.submit(video,frameTimestamp);
          frameHandle=video.requestVideoFrameCallback(frame);
        };
        const tick=()=>{ticks++;animationHandle=requestAnimationFrame(tick);};
        tick();
        if (offlineFps) {
          if (!Number.isFinite(video.duration) || video.duration > 600) throw new Error('Offline video exceeds 10 minute evaluation limit');
          for (let index=0;(index+0.5)/offlineFps<video.duration;index++) {
            const position=(index+0.5)/offlineFps;
            await new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>reject(new Error('Video seek timed out')),5000);
              video.onseeked=()=>{clearTimeout(timer);resolve();};
              video.currentTime=position;
            });
            frameTimestamp=position*1000; presented++;
            if (!await pipeline.submit(video,frameTimestamp)) throw new Error(failure||'Offline frame rejected');
            while(pipeline.pending && !failure) await new Promise(resolve=>setTimeout(resolve,5));
            if (failure) throw new Error(failure);
          }
        } else {
          frameHandle=video.requestVideoFrameCallback(frame);
          await video.play();
          while(!video.ended && !failure && performance.now()-playbackStarted<610000) await new Promise(resolve=>setTimeout(resolve,25));
          if (failure || !video.ended) throw new Error(failure||'Video exceeds 10 minute evaluation limit');
        }
        const playbackMs=performance.now()-playbackStarted;
        const draining=performance.now();
        while(pipeline.pending && !failure && performance.now()-draining<5500) await new Promise(resolve=>setTimeout(resolve,10));
        if(failure || pipeline.pending) throw new Error(failure||'Final frame timed out');
        const duration=offlineFps?video.duration*1000:Math.max(frameTimestamp,video.currentTime*1000);
        const report=round.finish(duration);
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const percentile=(values,fraction)=>{const sorted=[...values].sort((left,right)=>left-right);return sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]:null;};
        return {events:report.events,duration_ms:Math.floor(duration),stance,model:config.model,delegate:pipeline.delegate,requested_delegate:config.delegate,model_sha256:config.sha256,
          workload:synthetic?'synthetic blank video; not human accuracy':offlineFps?'offline sequential video sampling; not real-time performance':'local video real-time replay; not live camera or concurrent recording',
          sampling_fps:offlineFps||null,
          input_width:Math.min(video.videoWidth,inputWidth),
          frame_dispatch:offlineFps?'sequential':dispatch,
          invalid_reason_counts:invalidReasons,...(diagnostics?{feature_frames:featureFrames,pose_frames:poseFrames}:{}),
          performance:{playback_ms:playbackMs,presented_frames:presented,analysis_frames:inference.length,valid_pose_frames:valid,
            capture_p95_ms:percentile(captureTimes,.95),postprocess_p95_ms:percentile(postprocessTimes,.95),
            preprocess_p95_ms:percentile(preprocessTimes,.95),result_preparation_p95_ms:percentile(preparationTimes,.95),delivery_overhead_p95_ms:percentile(deliveryTimes,.95),
            video_frame_age_p95_ms:percentile(frameAges,.95),result_to_animation_p95_ms:percentile(animationDelays,.95),
            presentation_fps:presented*1000/playbackMs,analysis_fps:inference.length*1000/playbackMs,animation_fps:ticks*1000/playbackMs,
            inference_median_ms:percentile(inference,.5),inference_p95_ms:percentile(inference,.95),transport_p95_ms:percentile(transport,.95)},
          score_publications:publications,finalized_on_end_ids:report.events.filter(event=>!publications.some(publication=>publication.id===event.id)).map(event=>event.id)};
      } finally {pipeline.stop();video.pause();video.cancelVideoFrameCallback(frameHandle);cancelAnimationFrame(animationHandle);URL.revokeObjectURL(objectUrl);}
    },{synthetic,stance,delegate:argumentsMap['--delegate'],diagnostics:argumentsMap['--diagnostics']==='true',offlineFps,dispatch,inputWidth,modelHash});
    result.clip_id=clipId;
    if(videoPath) result.input_sha256=crypto.createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
    process.stdout.write(JSON.stringify({clip_id:clipId,events:result.events.length,workload:result.workload,performance:result.performance})+'\n');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}

main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
