export function withLocalInput(output, request) {
  let active = null;
  const stop = () => {
    active?.cancel();
    active = null;
    output?.stop();
  };
  return {
    ...output,
    stop,
    finishInput() { active?.finish(); },
    async listen({language, signal, onStart, onProcessing}) {
      stop();
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('speech_unavailable');
      let stream, recorder, timer;
      const chunks = [];
      let rejectCapture, resolveCapture;
      const captured = new Promise((resolve,reject) => {resolveCapture=resolve;rejectCapture=reject;});
      captured.catch(()=>{});
      const release = () => {clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());};
      const capture = {cancel:()=>{
        if (recorder?.state === 'recording') recorder.stop();
        release();
        rejectCapture(new DOMException('Cancelled','AbortError'));
      },finish:()=>{if (recorder?.state === 'recording') recorder.stop();}};
      active = capture;
      signal.addEventListener('abort',capture.cancel,{once:true});
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
        if (signal.aborted || active !== capture) throw new DOMException('Cancelled','AbortError');
        const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream,mimeType ? {mimeType} : {});
        recorder.ondataavailable = event => {if(event.data.size) chunks.push(event.data);};
        recorder.onerror = () => rejectCapture(new Error('speech_failed'));
        recorder.onstop = () => {release();resolveCapture(new Blob(chunks,{type:recorder.mimeType}));};
        recorder.start();
        onStart();
        timer = setTimeout(capture.finish,20000);
        const audio = await captured;
        if (signal.aborted || active !== capture) throw new DOMException('Cancelled','AbortError');
        onProcessing?.();
        const response = await request(`/speech/transcribe/${language}`,{method:'POST',body:audio,headers:{'Content-Type':audio.type || 'application/octet-stream'},signal});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'speech_failed');
        return result;
      } finally {
        release();
        signal.removeEventListener('abort',capture.cancel);
        if (active === capture) active = null;
      }
    },
  };
}
