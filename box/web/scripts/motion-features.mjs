const subtract = (first, second) => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z });
const magnitude = value => Math.hypot(value.x, value.y, value.z);

function elbowAngle(shoulder, elbow, wrist) {
  const upper = subtract(shoulder, elbow);
  const lower = subtract(wrist, elbow);
  const divisor = magnitude(upper) * magnitude(lower);
  if (divisor < 0.0001) return NaN;
  const cosine = (upper.x * lower.x + upper.y * lower.y + upper.z * lower.z) / divisor;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

export function poseFeatures(result) {
  const invalid = reason => ({ timestamp: result.timestamp, valid: false, reason, arms: {} });
  if (!Number.isFinite(result.timestamp)) return invalid('invalid_timestamp');
  if (!result.multiplePeopleCheck || result.poses?.length !== 1) return invalid('person_count_unconfirmed');
  if (result.model !== 'mediapipe') return invalid('depth_adapter_unavailable');
  const pose = result.poses[0];
  const world = pose.worldLandmarks;
  const image = pose.landmarks;
  const required = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  if (!Array.isArray(world) || !Array.isArray(image)) return invalid('missing_landmarks');
  for (const index of required) {
    const point = world[index];
    const observation = image[index];
    if (!point || !observation || ![point.x, point.y, point.z, observation.x, observation.y, observation.visibility].every(Number.isFinite)) return invalid('invalid_landmarks');
    if (observation.visibility < 0.65 || (Number.isFinite(observation.presence) && observation.presence < 0.65) || observation.x < 0 || observation.x > 1 || observation.y < 0 || observation.y > 1) return invalid('occluded_or_outside');
  }
  const scale = magnitude(subtract(world[11], world[12]));
  if (scale < 0.12 || scale > 0.8) return invalid('unstable_body_scale');
  const imageShoulderWidth = Math.hypot(image[11].x - image[12].x, image[11].y - image[12].y);
  const imageWristGap = Math.hypot(image[15].x - image[16].x, image[15].y - image[16].y);
  if (imageShoulderWidth < 0.05 || imageWristGap < imageShoulderWidth * 0.12) return invalid('overlapping_hands');
  const arms = {};
  for (const [hand, shoulderIndex, elbowIndex, wristIndex] of [['left', 11, 13, 15], ['right', 12, 14, 16]]) {
    const wrist = world[wristIndex];
    const shoulder = world[shoulderIndex];
    const relative = subtract(wrist, shoulder);
    const angle = elbowAngle(shoulder, world[elbowIndex], wrist);
    if (!Number.isFinite(angle)) return invalid('degenerate_arm');
    arms[hand] = {
      position: { x: relative.x / scale, y: relative.y / scale, z: relative.z / scale },
      elbowAngle: angle,
      confidence: Math.min(...[shoulderIndex, elbowIndex, wristIndex].map(index => image[index].visibility)),
      guard: magnitude(subtract(wrist, world[0])) / scale < 0.95 && wrist.y < shoulder.y + scale * 0.2,
    };
  }
  return { timestamp: result.timestamp, valid: true, arms, scale, estimatedDepth: true };
}
