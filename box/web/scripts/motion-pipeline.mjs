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
    const generation = this.generation;
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') {
          clearTimeout(this.timer);
          this.ready = true;
        } else if (data.type === 'result' && this.pending?.id === data.id) {
          const pending = this.pending;
          clearTimeout(this.timer);
          this.pending = null;
          this.onResult({ ...data, latencyMs: this.now() - pending.started });
        } else if (data.type === 'error') {
          this.fail(new Error(data.message || '분석 처리 실패'));
        }
      };
      worker.onerror = () => {
        if (generation === this.generation) this.fail(new Error('분석 Worker 실행 실패'));
      };
      this.timer = setTimeout(() => this.fail(new Error('분석 모델 준비 시간 초과')), 30000);
      worker.postMessage({ type: 'init', config });
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
      this.worker.postMessage({ type: 'frame', id, timestamp, bitmap }, [bitmap]);
      return true;
    } catch (error) {
      bitmap?.close();
      if (generation === this.generation) this.fail(error);
      return false;
    }
  }

  fail(error) {
    this.stop();
    this.onError(error);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    this.ready = false;
    this.lastFrame = -Infinity;
  }
}
