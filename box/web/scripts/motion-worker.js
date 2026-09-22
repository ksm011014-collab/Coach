let detector = null;
let model = '';
let canvas = null;
let busy = false;
let initialized = false;
let lastTimestamp = -Infinity;

function assetPath(value) {
  const url = new URL(value, self.location.href);
  if (url.origin !== self.location.origin) throw new Error('분석 자산은 같은 서버에서 제공해야 합니다.');
  return url.href;
}

async function initialize(config) {
  if (initialized) throw new Error('분석 Worker는 다시 초기화할 수 없습니다.');
  initialized = true;
  model = config.model;
  if (model === 'movenet') {
    importScripts(assetPath(config.tensorflow), assetPath(config.poseDetection));
    await tf.setBackend('webgl');
    await tf.ready();
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl: assetPath(config.modelPath), enableSmoothing: true,
    });
  } else if (model === 'mediapipe') {
    const { FilesetResolver, PoseLandmarker } = await import(assetPath(config.module));
    const fileset = await FilesetResolver.forVisionTasks(assetPath(config.wasm));
    detector = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: assetPath(config.modelPath), delegate: config.delegate === 'CPU' ? 'CPU' : 'GPU' },
      runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: false,
      minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
    });
  } else {
    throw new Error('지원하지 않는 분석 모델입니다.');
  }
  const warmupStarted = performance.now();
  canvas = new OffscreenCanvas(640, 480);
  canvas.getContext('2d').fillRect(0, 0, 640, 480);
  if (model === 'movenet') await detector.estimatePoses(canvas, { flipHorizontal: false }, 0);
  else detector.detectForVideo(canvas, 0);
  self.postMessage({ type: 'ready', model, warmupMs: performance.now() - warmupStarted });
}

async function processFrame(message) {
  const { bitmap, id, timestamp } = message;
  try {
    if (!detector || busy || !Number.isFinite(timestamp) || timestamp <= lastTimestamp) throw new Error('분석 프레임 순서 오류');
    busy = true;
    lastTimestamp = timestamp;
    const started = performance.now();
    canvas ||= new OffscreenCanvas(bitmap.width, bitmap.height);
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    let poses;
    if (model === 'movenet') {
      const result = await detector.estimatePoses(canvas, { flipHorizontal: false }, timestamp);
      poses = result.map(pose => ({ score: pose.score, landmarks: pose.keypoints.map(point => ({ name: point.name, x: point.x / canvas.width, y: point.y / canvas.height, visibility: point.score })) }));
    } else {
      const result = detector.detectForVideo(canvas, timestamp);
      poses = result.landmarks.map((landmarks, index) => ({ landmarks, worldLandmarks: result.worldLandmarks[index] }));
    }
    self.postMessage({ type: 'result', id, timestamp, model, poses, inferenceMs: performance.now() - started, multiplePeopleCheck: model === 'mediapipe' });
  } finally {
    bitmap?.close();
    busy = false;
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') await initialize(data.config);
    else if (data.type === 'frame') await processFrame(data);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
