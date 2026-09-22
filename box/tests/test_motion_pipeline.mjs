import assert from 'node:assert/strict';
import { MotionPipeline } from '../web/scripts/motion-pipeline.mjs';

const workers = [];
const results = [];
const errors = [];
let finishCapture;
let clock = 0;
let closed = 0;
const pipeline = new MotionPipeline({
  workerFactory: () => {
    const worker = { messages: [], postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  },
  capture: () => new Promise(resolve => { finishCapture = () => resolve({ close() { closed++; } }); }),
  onResult: result => results.push(result), onError: error => errors.push(error), now: () => clock,
});
pipeline.start({ model: 'test' });
assert.equal(await pipeline.submit({}, 0), false);
workers[0].onmessage({ data: { type: 'ready' } });
const first = pipeline.submit({}, 0);
assert.equal(await pipeline.submit({}, 50), false);
finishCapture();
assert.equal(await first, true);
const firstId = workers[0].messages[1].id;
workers[0].onmessage({ data: { type: 'result', id: firstId + 1 } });
assert.equal(results.length, 0);
clock = 32;
workers[0].onmessage({ data: { type: 'result', id: firstId } });
assert.equal(results[0].latencyMs, 32);
workers[0].onmessage({ data: { type: 'result', id: firstId } });
assert.equal(results.length, 1);
assert.equal(await pipeline.submit({}, 30), false);
const pending = pipeline.submit({}, 50);
pipeline.stop();
finishCapture();
assert.equal(await pending, false);
assert.equal(closed, 1);
assert.equal(workers[0].terminated, true);
pipeline.start({ model: 'test' });
workers[0].onmessage({ data: { type: 'ready' } });
assert.equal(pipeline.ready, false);
workers[1].onmessage({ data: { type: 'ready' } });
pipeline.timeoutMs = 10;
const stalled = pipeline.submit({}, 100);
await new Promise(resolve => setTimeout(resolve, 25));
assert.equal(errors.length, 1);
assert.equal(pipeline.ready, false);
finishCapture();
assert.equal(await stalled, false);
assert.equal(closed, 2);
pipeline.stop();
console.log('Motion pipeline: no frame backlog, throttling, stale/duplicate results, cancellation and timeout cleanup passed.');
