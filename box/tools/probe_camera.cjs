const {chromium}=require('playwright');

(async()=>{
  let browser;
  let timer;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,args:process.argv.includes('--legacy-capture')?['--disable-features=MediaFoundationVideoCapture']:[]});
    const context=await browser.newContext({permissions:['camera'],serviceWorkers:'block'});
    const page=await context.newPage();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><video autoplay muted></video>'}));
    await page.goto('http://127.0.0.1:8000');
    const result=await Promise.race([page.evaluate(async()=>{
      let stream;
      try {
        stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
        const video=document.querySelector('video');
        video.srcObject=stream;
        await video.play();
        let frames=0;
        let callback;
        const tick=()=>{frames++;callback=video.requestVideoFrameCallback(tick);};
        callback=video.requestVideoFrameCallback(tick);
        await new Promise(resolve=>setTimeout(resolve,5000));
        video.cancelVideoFrameCallback(callback);
        return {frames,width:video.videoWidth,height:video.videoHeight,track:stream.getVideoTracks()[0].readyState};
      } catch(error) {return {error:error.name,message:error.message};}
      finally {stream?.getTracks().forEach(track=>track.stop());}
    }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Camera probe timed out after 20 seconds')),20000);})]);
    console.log(JSON.stringify(result));
    if (result.error || result.track!=='live' || !result.frames) process.exitCode=1;
  } finally {clearTimeout(timer);await browser?.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
