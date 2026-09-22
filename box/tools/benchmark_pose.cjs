const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

async function main() {
  const directory = path.resolve(__dirname, '../artifacts/pose-benchmark');
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      return response.end('<!doctype html><canvas id="input" width="640" height="480"></canvas>');
    }
    const target = path.resolve(directory, '.' + decodeURIComponent(request.url.split('?')[0]));
    if (!target.startsWith(directory + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404);
      return response.end();
    }
    response.setHeader('Content-Type', target.endsWith('.wasm') ? 'application/wasm' : /\.(mjs|js)$/.test(target) ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const candidate of ['movenet', 'mediapipe-cpu', 'mediapipe-gpu']) {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      try {
        if (candidate === 'movenet') {
          await page.addScriptTag({ url: '/node_modules/@tensorflow/tfjs/dist/tf.min.js' });
          await page.addScriptTag({ url: '/node_modules/@tensorflow-models/pose-detection/dist/pose-detection.min.js' });
        }
        const result = await page.evaluate(async candidate => {
          const canvas = document.querySelector('canvas');
          const context = canvas.getContext('2d');
          context.fillStyle = '#808080';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const rendererCanvas = document.createElement('canvas');
          const graphics = rendererCanvas.getContext('webgl2');
          const extension = graphics?.getExtension('WEBGL_debug_renderer_info');
          const renderer = extension ? graphics.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
          const loadStarted = performance.now();
          let detector;
          let infer;
          if (candidate === 'movenet') {
            await tf.setBackend('webgl');
            await tf.ready();
            detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });
            infer = timestamp => detector.estimatePoses(canvas, {}, timestamp);
          } else {
            const { FilesetResolver, PoseLandmarker } = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
            const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
            detector = await PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: candidate.endsWith('gpu') ? 'GPU' : 'CPU' },
              runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: false,
            });
            infer = timestamp => detector.detectForVideo(canvas, timestamp);
          }
          const loadMs = performance.now() - loadStarted;
          const durations = [];
          let posesDetected = 0;
          for (let frame = 0; frame < 130; frame++) {
            const started = performance.now();
            const detected = await infer(frame * 40 + 1);
            posesDetected += Array.isArray(detected) ? detected.length : detected.landmarks.length;
            if (frame >= 10) durations.push(performance.now() - started);
          }
          detector.dispose?.();
          detector.close?.();
          durations.sort((left, right) => left - right);
          return { candidate, renderer, loadMs, frames: durations.length, medianMs: durations[Math.floor(durations.length / 2)], p95Ms: durations[Math.floor(durations.length * 0.95)], posesDetected, workload: 'blank-frame smoke only; not pose accuracy or live throughput', execution: 'main thread; worker integration pending' };
        }, candidate);
        results.push(result);
      } catch (error) {
        results.push({ candidate, error: error.message });
      } finally {
        await page.close();
      }
      process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
    }
    fs.writeFileSync(path.join(directory, 'smoke-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (results.some(result => result.error)) process.exitCode = 1;
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
