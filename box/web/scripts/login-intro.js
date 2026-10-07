window.LoginIntro = (() => {
  let canvas = null;
  let frame = null;
  let transitionStarted = null;
  let transitionPromise = null;
  let resolveTransition = null;
  let transitionTimer = null;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(transitionTimer);
    canvas?.remove();
    canvas = null;
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
    const stars = Array.from({length: 120}, () => ({angle: Math.random() * Math.PI * 2, depth: Math.random(), speed: 0.15 + Math.random() * 0.25}));
    const started = performance.now();
    let previous = started;
    const draw = now => {
      if (!canvas || panel.classList.contains('hidden')) { stop(); return; }
      const width = Math.min(1600, panel.clientWidth);
      const height = Math.min(1000, panel.clientHeight);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const progress = transitionStarted === null ? 0 : Math.min(1, (now - transitionStarted) / 3000);
      const speed = 1 + progress ** 2 * 9;
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      context.fillStyle = '#02090e';
      context.fillRect(0, 0, width, height);
      for (const star of stars) {
        if (!reducedMotion()) star.depth = (star.depth + delta * star.speed * speed) % 1;
        const distance = star.depth ** 2 * Math.max(width, height) * 0.8;
        const tail = Math.max(2, star.depth ** 3 * (100 + progress * 220));
        const centerX = width * 0.48;
        const centerY = height * 0.5;
        context.strokeStyle = `rgba(86,255,225,${star.depth * 0.8})`;
        context.lineWidth = 0.5 + star.depth * 2;
        context.beginPath();
        context.moveTo(centerX + Math.cos(star.angle) * distance, centerY + Math.sin(star.angle) * distance);
        context.lineTo(centerX + Math.cos(star.angle) * (distance + tail), centerY + Math.sin(star.angle) * (distance + tail));
        context.stroke();
      }
      if (!reducedMotion()) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  }
  function enter() {
    if (transitionPromise) return transitionPromise;
    show();
    if (!canvas || reducedMotion()) return Promise.resolve(true);
    transitionStarted = performance.now();
    document.querySelector('#loginPanel').classList.add('login-entering');
    document.querySelectorAll('#loginPanel > .intro, #loginPanel > .auth-card').forEach(element => { element.inert = true; });
    transitionPromise = new Promise(resolve => { resolveTransition = resolve; });
    transitionTimer = setTimeout(() => { resolveTransition?.(true); resolveTransition = null; }, 3000);
    return transitionPromise;
  }
  return {show, enter, stop};
})();
