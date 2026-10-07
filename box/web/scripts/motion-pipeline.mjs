export class MotionPipeline {
  constructor({ workerFactory, capture = source => createImageBitmap(source), onResult = () => {}, onError = () => {}, now = () => performance.now(), timeoutMs = 5000, intervalMs = 40 }) {
    this.workerFactory = workerFactory;
    this.capture = capture;
    this.onResult = onResult;
    this.onError = onError;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.generation = 0;
    this.sequence = 0;
    this.worker = null;
    this.pending = null;
    this.ready = false;
    this.lastFrame = -Infinity;
  }

  start(config) {
    this.stop();
    this.fallbackConfig = config.model === 'mediapipe' && config.delegate === 'AUTO' ? { ...config, delegate: 'CPU' } : null;
    const workerConfig = this.fallbackConfig ? { ...config, delegate: 'GPU' } : config;
    const generation = this.generation;
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') {
          clearTimeout(this.timer);
          this.ready = true;
          this.delegate = data.delegate || workerConfig.delegate;
        } else if (data.type === 'result' && this.pending?.id === data.id) {
          const pending = this.pending;
          clearTimeout(this.timer);
          this.pending = null;
          this.onResult({ ...data, latencyMs: this.now() - pending.started, captureMs: pending.captureMs });
          if (generation === this.generation) this.drain();
        } else if (data.type === 'error') {
          this.fail(new Error(data.message || '분석 처리 실패'));
        }
      };
      worker.onerror = () => {
        if (generation === this.generation) this.fail(new Error('분석 Worker 실행 실패'));
      };
      this.timer = setTimeout(() => this.fail(new Error('분석 모델 준비 시간 초과')), 30000);
      worker.postMessage({ type: 'init', config: workerConfig });
    } catch (error) {
      this.fail(error);
    }
  }

  async submit(source, timestamp = this.now()) {
    if (!this.ready || this.pending || !Number.isFinite(timestamp) || timestamp - this.lastFrame < this.intervalMs) return false;
    const generation = this.generation;
    const id = ++this.sequence;
    this.pending = { id, started: this.now() };
    this.lastFrame = timestamp;
    this.timer = setTimeout(() => this.fail(new Error('분석 응답 시간 초과')), this.timeoutMs);
    let bitmap;
    try {
      bitmap = await this.capture(source);
      if (generation !== this.generation) {
        bitmap.close();
        return false;
      }
      this.pending.captureMs = this.now() - this.pending.started;
      this.worker.postMessage({ type: 'frame', id, timestamp, bitmap }, [bitmap]);
      return true;
    } catch (error) {
      bitmap?.close();
      if (generation === this.generation) this.fail(error);
      return false;
    }
  }

  offer(source, timestamp = this.now()) {
    if (!this.ready || !Number.isFinite(timestamp) || timestamp <= this.lastFrame || timestamp <= (this.latest?.timestamp ?? -Infinity)) return false;
    this.latest = { source, timestamp };
    this.drain();
    return true;
  }

  drain() {
    if (!this.ready || this.pending || !this.latest || this.latest.timestamp - this.lastFrame < this.intervalMs) return;
    const latest = this.latest;
    this.latest = null;
    void this.submit(latest.source, latest.timestamp);
  }

  fail(error) {
    const fallback = this.fallbackConfig;
    this.stop();
    if (fallback) {
      this.start(fallback);
      return;
    }
    this.onError(error);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    this.latest = null;
    this.ready = false;
    this.delegate = null;
    this.fallbackConfig = null;
    this.lastFrame = -Infinity;
  }
}
