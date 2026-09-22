const NAMES = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
const MEDIAPIPE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export const BONES = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

export function normalizedSkeleton(result, threshold = 0.6) {
  if (result.poses?.length !== 1) return [];
  const points = result.poses[0].landmarks;
  if (!Array.isArray(points)) return [];
  return NAMES.map((name, index) => {
    const point = result.model === 'mediapipe' ? points[MEDIAPIPE[index]] : points.find(candidate => candidate.name === name);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.visibility) || point.visibility < threshold || (Number.isFinite(point.presence) && point.presence < threshold) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
    return { name, x: point.x, y: point.y, confidence: point.visibility };
  });
}

export function projectPoint(point, sourceWidth, sourceHeight, width, height, mirrored = true) {
  if (![sourceWidth, sourceHeight, width, height].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const horizontal = (mirrored ? 1 - point.x : point.x) * sourceWidth * scale + (width - sourceWidth * scale) / 2;
  const vertical = point.y * sourceHeight * scale + (height - sourceHeight * scale) / 2;
  return { x: horizontal, y: vertical };
}

export class SkeletonOverlay {
  constructor(canvas, video, { mirrored = true, maxAgeMs = 250 } = {}) {
    this.canvas = canvas;
    this.video = video;
    this.mirrored = mirrored;
    this.maxAgeMs = maxAgeMs;
    this.result = null;
    this.receivedAt = -Infinity;
  }

  update(result, now = performance.now()) {
    this.result = result;
    this.receivedAt = now;
  }

  draw(now = performance.now()) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const context = this.canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!this.result || now - this.receivedAt > this.maxAgeMs || !width || !height || this.video.readyState < 2) return;
    const points = normalizedSkeleton(this.result).map(point => point && projectPoint(point, this.video.videoWidth, this.video.videoHeight, width, height, this.mirrored));
    context.lineWidth = 3;
    context.strokeStyle = '#30eddb';
    context.fillStyle = '#ffffff';
    context.shadowColor = '#001b22';
    context.shadowBlur = 3;
    for (const [start, end] of BONES) {
      if (!points[start] || !points[end]) continue;
      context.beginPath();
      context.moveTo(points[start].x, points[start].y);
      context.lineTo(points[end].x, points[end].y);
      context.stroke();
    }
    for (const point of points) {
      if (!point) continue;
      context.beginPath();
      context.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      context.fill();
    }
  }

  clear() {
    this.result = null;
    this.draw();
  }
}
