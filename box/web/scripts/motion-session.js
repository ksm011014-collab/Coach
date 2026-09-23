window.MotionSession = (() => {
  let generation = 0;
  let pipeline = null;
  let overlay = null;
  let animation = null;
  let request = null;
  let round = null;
  let features = null;

  async function beginRound(stance = 'orthodox', feedbackMode = 'summary') {
    const current = generation;
    round = null;
    try {
      const [{MotionRound},{poseFeatures}] = await Promise.all([import('/scripts/motion-round.mjs'),import('/scripts/motion-features.mjs')]);
      if (current !== generation) return;
      features = poseFeatures;
      round = new MotionRound({startedAt:performance.now(),stance,feedbackMode});
    } catch (_) {}
    if (current !== generation) return;
    const score = document.querySelector('#motionScore');
    if (score) score.textContent = '0';
    const feedback = document.querySelector('#motionFeedback');
    if (feedback) feedback.textContent = round ? t('{stance} · 가드를 올리고 준비하세요 · 시험 판정', {stance:stance === 'southpaw' ? t('사우스포 · 오른손 앞') : t('오소독스 · 왼손 앞')}) : t('동작 평가 준비 실패 · 운동 시간과 녹화는 계속 저장합니다');
  }

  function finishRound() {
    const report = round?.finish(performance.now());
    updateRound();
    return report;
  }

  function clear() {
    stop();
    round = null;
    const score = document.querySelector('#motionScore');
    if (score) score.textContent = '0';
    const feedback = document.querySelector('#motionFeedback');
    if (feedback) feedback.textContent = '';
  }

  function updateRound() {
    if (!round) return;
    const score = document.querySelector('#motionScore');
    if (score) score.textContent = String(round.totalPoints);
    const message = round.feedback(performance.now());
    const feedback = document.querySelector('#motionFeedback');
    if (message && feedback) feedback.textContent = message;
  }

  function stop() {
    generation++;
    request?.abort();
    request = null;
    cancelAnimationFrame(animation);
    pipeline?.stop();
    overlay?.clear();
    pipeline = null;
    overlay = null;
    const status = document.querySelector('#motionStatus');
    if (status) status.textContent = '';
  }

  async function start(video) {
    stop();
    const current = generation;
    const status = document.querySelector('#motionStatus');
    const canvas = document.querySelector('#motionSkeleton');
    if (!status || !canvas) return;
    status.textContent = t('스켈레톤 준비 중');
    request = new AbortController();
    try {
      const response = await fetch('/vendor/motion/manifest.json', { signal: request.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(t('분석 모델 설치 필요'));
      const config = await response.json();
      const [{ MotionPipeline }, { SkeletonOverlay }] = await Promise.all([import('/scripts/motion-pipeline.mjs'), import('/scripts/motion-skeleton.mjs')]);
      if (current !== generation) return;
      overlay = new SkeletonOverlay(canvas, video);
      let failed = false;
      pipeline = new MotionPipeline({
        workerFactory: () => new Worker('/scripts/motion-worker.js'),
        capture: source => {
          const width = Math.min(source.videoWidth, 640);
          const height = Math.max(1, Math.round(source.videoHeight * width / source.videoWidth));
          return createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
        },
        onResult: result => {
          if (current !== generation) return;
          overlay.update(result);
          if (round && features) round.update(features(result));
          updateRound();
          status.textContent = result.poses.length > 1 ? t('한 사람만 화면에 들어오세요') : result.poses.length ? t('스켈레톤 시험 실행 · 실제 정확도 검증 전') : t('몸이 보이도록 카메라를 맞춰주세요');
        },
        onError: () => {
          if (current !== generation) return;
          failed = true;
          overlay.clear();
          status.textContent = t('자세 추적 중단 · 카메라와 녹화는 계속 사용할 수 있습니다');
        },
      });
      pipeline.start(config);
      const draw = () => {
        if (current !== generation || failed) return;
        overlay.draw();
        if (!document.hidden && video.readyState >= 2 && !video.paused) pipeline.submit(video);
        animation = requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') status.textContent = t('자세 추적 사용 불가 · 모델 설치를 확인하세요');
    }
  }

  return { start, stop, clear, beginRound, finishRound };
})();
