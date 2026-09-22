const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

async function main() {
  const assets = path.resolve(__dirname, '../artifacts/pose-benchmark');
  const scripts = path.resolve(__dirname, '../web/scripts');
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      return response.end('<!doctype html><canvas width="640" height="480"></canvas>');
    }
    const source = pathname.startsWith('/scripts/') ? scripts : assets;
    const relative = pathname.startsWith('/scripts/') ? pathname.slice(9) : pathname.slice(1);
    const file = path.resolve(source, relative);
    if (!file.startsWith(source + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      return response.end();
    }
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(mjs|js)$/.test(file) ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const output = await page.evaluate(async () => {
      const { MotionPipeline } = await import('/scripts/motion-pipeline.mjs');
      const frames = [];
      let ticks = 0;
      let raf;
      const tick = () => { ticks++; raf = requestAnimationFrame(tick); };
      tick();
      const canvas = document.querySelector('canvas');
      canvas.getContext('2d').fillRect(0, 0, 640, 480);
      const pipeline = new MotionPipeline({
        workerFactory: () => new Worker('/scripts/motion-worker.js'),
        onResult: result => frames.push(result),
      });
      let failure;
      pipeline.onError = error => { failure = error.message; };
      pipeline.start({ model: 'mediapipe', module: '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', wasm: '/node_modules/@mediapipe/tasks-vision/wasm', modelPath: '/pose_landmarker_lite.task', delegate: 'GPU' });
      const started = performance.now();
      try {
        while (frames.length < 60 && !failure && performance.now() - started < 45000) {
          await pipeline.submit(canvas);
          await new Promise(resolve => setTimeout(resolve, 8));
        }
        if (failure) throw new Error(failure);
        if (frames.length < 60) throw new Error('Worker benchmark did not complete');
        const inference = frames.slice(10).map(frame => frame.inferenceMs).sort((left, right) => left - right);
        const latency = frames.slice(10).map(frame => frame.latencyMs).sort((left, right) => left - right);
        return { workload: 'blank image; not human tracking accuracy', execution: 'dedicated worker, local model', frames: frames.length, animationTicks: ticks, inferenceMedianMs: inference[25], inferenceP95Ms: inference[47], transportP95Ms: latency[47] };
      } finally {
        pipeline.stop();
        cancelAnimationFrame(raf);
      }
    });
    fs.writeFileSync(path.join(assets, 'worker-results.json'), JSON.stringify(output, null, 2));
    process.stdout.write(JSON.stringify(output) + '\n');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
