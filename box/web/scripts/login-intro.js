window.LoginIntro = (() => {
  let canvas = null;
  let frame = null;
  let transitionStarted = null;
  let transitionPromise = null;
  let resolveTransition = null;
  let transitionTimer = null;
  let assemblyVideo = null;
  let assemblyCompletedAt = null;
  let assemblyUrl = null;
  const entryDuration = 10000;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(transitionTimer);
    canvas?.remove();
    canvas = null;
    assemblyVideo?.pause();
    assemblyVideo?.remove();
    assemblyVideo = null;
    assemblyCompletedAt = null;
    if (assemblyUrl) URL.revokeObjectURL(assemblyUrl);
    assemblyUrl = null;
    transitionStarted = null;
    transitionPromise = null;
    document.querySelector('#loginPanel')?.classList.remove('login-entering');
    document.querySelectorAll('#loginPanel > .intro, #loginPanel > .auth-card').forEach(element => { element.inert = false; });
    resolveTransition?.(false);
    resolveTransition = null;
  }
  function show() {
    if (canvas) return;
    const panel = document.querySelector('#loginPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    canvas = document.createElement('canvas');
    canvas.className = 'login-warp';
    canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d');
    if (!context) { canvas = null; return; }
    panel.prepend(canvas);
    const activeCanvas = canvas;
    const stars = Array.from({length: 120}, () => ({angle: Math.random() * Math.PI * 2, depth: Math.random(), speed: 0.15 + Math.random() * 0.25}));
    const started = performance.now();
    let previous = started;
    const draw = now => {
      if (canvas !== activeCanvas) return;
      if (panel.classList.contains('hidden')) { stop(); return; }
      const width = Math.min(1600, panel.clientWidth);
      const height = Math.min(1000, panel.clientHeight);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const progress = transitionStarted === null ? 0 : Math.min(1, (now - transitionStarted) / entryDuration);
      const speed = 1 + progress ** 2 * 9;
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      const centerX = width*.5;
      const centerY = height*.5;
      context.shadowColor = 'rgba(86,255,225,.5)';
      context.shadowBlur = 6;
      for (const star of stars) {
        if (!reducedMotion()) star.depth = (star.depth + delta * star.speed * speed) % 1;
        const distance = star.depth ** 2 * Math.max(width, height) * 0.8;
        const tail = Math.max(2, star.depth ** 3 * (100 + progress * 220));
        context.strokeStyle = `rgba(86,255,225,${star.depth * 0.8})`;
        context.lineWidth = 0.5 + star.depth*2;
        context.beginPath();
        context.moveTo(centerX + Math.cos(star.angle) * distance, centerY + Math.sin(star.angle) * distance);
        context.lineTo(centerX + Math.cos(star.angle) * (distance + tail), centerY + Math.sin(star.angle) * (distance + tail));
        context.stroke();
      }
      context.shadowBlur = 0;
      const entering = transitionStarted !== null;
      if (entering && !reducedMotion()) {
        if (assemblyVideo?.readyState >= 2) {
          // Play the supplied finished clip unchanged, with its own tunnel and shine.
          const scale = Math.min(width/assemblyVideo.videoWidth,height/assemblyVideo.videoHeight);
          const videoWidth = assemblyVideo.videoWidth*scale;
          const videoHeight = assemblyVideo.videoHeight*scale;
          context.fillStyle = '#000';
          context.fillRect(0,0,width,height);
          context.drawImage(assemblyVideo,(width-videoWidth)/2,(height-videoHeight)/2,videoWidth,videoHeight);
        }
      }
      if (!reducedMotion()) frame = requestAnimationFrame(draw);
    };
    if (typeof HTMLVideoElement !== 'undefined') {
      const video = document.createElement('video');
      assemblyVideo = video;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.display = 'none';
      panel.appendChild(video);
      video.onloadeddata = () => {
        if (canvas === activeCanvas && transitionStarted !== null) video.play().catch(() => {});
      };
      video.onplaying = () => {
        if (canvas !== activeCanvas || transitionStarted === null) return;
        clearTimeout(transitionTimer);
        const remaining = Number.isFinite(video.duration) ? (video.duration-video.currentTime)*1000+500 : entryDuration;
        transitionTimer = setTimeout(() => { resolveTransition?.(true); resolveTransition = null; }, remaining);
      };
      video.onended = () => {
        if (canvas !== activeCanvas || transitionStarted === null) return;
        clearTimeout(transitionTimer);
        resolveTransition?.(true);
        resolveTransition = null;
      };
      // Buffer the supplied clip so playback also works on
      // installed workers and hosts that do not implement HTTP byte ranges.
      fetch('/brand/seonrang-assembly.mp4').then(response => {
        if (!response.ok) throw new Error('assembly_video_unavailable');
        return response.blob();
      }).then(blob => {
        if (canvas !== activeCanvas) return;
        assemblyUrl = URL.createObjectURL(blob);
        video.src = assemblyUrl;
        video.load();
      }).catch(() => {});
    }
    frame = requestAnimationFrame(draw);
  }
  function enter() {
    if (transitionPromise) return transitionPromise;
    show();
    if (!canvas || reducedMotion()) return Promise.resolve(true);
    transitionStarted = performance.now();
    if (assemblyVideo) {
      assemblyVideo.playbackRate = 1;
      if (assemblyVideo.readyState >= 1) assemblyVideo.currentTime = 0;
      assemblyVideo.play().catch(() => {});
    }
    document.querySelector('#loginPanel').classList.add('login-entering');
    document.querySelectorAll('#loginPanel > .intro, #loginPanel > .auth-card').forEach(element => { element.inert = true; });
    transitionPromise = new Promise(resolve => { resolveTransition = resolve; });
    transitionTimer = setTimeout(() => { resolveTransition?.(true); resolveTransition = null; }, entryDuration);
    return transitionPromise;
  }
  return {show, enter, stop};
})();
