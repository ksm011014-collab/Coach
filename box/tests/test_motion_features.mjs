import assert from 'node:assert/strict';
import { poseFeatures } from '../web/scripts/motion-features.mjs';

const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
Object.assign(world[0], { y: -0.2 });
for (const [shoulder, elbow, wrist, sign] of [[11, 13, 15, -1], [12, 14, 16, 1]]) {
  Object.assign(world[shoulder], { x: sign * 0.2 });
  Object.assign(world[elbow], { x: sign * 0.25, y: 0.2 });
  Object.assign(world[wrist], { x: sign * 0.12, y: -0.1, z: -0.1 });
}
const image = world.map(point => ({ x: 0.5 + point.x, y: 0.5 + point.y, visibility: 0.99 }));
const result = { timestamp: 100, model: 'mediapipe', multiplePeopleCheck: true, poses: [{ landmarks: image, worldLandmarks: world }] };
const valid = poseFeatures(result);
assert.equal(valid.valid, true);
assert.equal(valid.arms.left.guard, true);
assert.equal(valid.arms.right.guard, true);
assert.equal(valid.estimatedDepth, true);
assert.equal(poseFeatures({ ...result, poses: [result.poses[0], result.poses[0]] }).valid, false);
assert.equal(poseFeatures({ ...result, model: 'movenet', multiplePeopleCheck: false }).valid, false);
const hidden = structuredClone(result);
hidden.poses[0].landmarks[15].visibility = 0.1;
assert.equal(poseFeatures(hidden).reason, 'occluded_or_outside');
const overlap = structuredClone(result);
overlap.poses[0].landmarks[15] = overlap.poses[0].landmarks[16];
assert.equal(poseFeatures(overlap).reason, 'overlapping_hands');
const translated = structuredClone(result);
for (const point of translated.poses[0].worldLandmarks) {
  point.x += 0.7;
  point.y += 0.3;
}
const translatedFrame = poseFeatures(translated);
assert.ok(Math.abs(translatedFrame.arms.left.position.x - valid.arms.left.position.x) < 1e-10);
assert.ok(Math.abs(translatedFrame.arms.left.elbowAngle - valid.arms.left.elbowAngle) < 1e-10);
console.log('Pose features: visibility, body scale, arm geometry, translation, multiple people and overlapping hands passed.');
