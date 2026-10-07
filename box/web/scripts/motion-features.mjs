const subtract = (first, second) => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z });
const magnitude = value => Math.hypot(value.x, value.y, value.z);
const dot = (first, second) => first.x * second.x + first.y * second.y + first.z * second.z;
const cross = (first, second) => ({ x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x });
const normalize = vector => {
  const length = magnitude(vector);
  return length > 0.0001 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null;
};

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
  const required = [0, 11, 12, 23, 24];
  if (!Array.isArray(world) || !Array.isArray(image)) return invalid('missing_landmarks');
  const landmarkProblem = index => {
    const point = world[index];
    const observation = image[index];
    if (!point || !observation || ![point.x, point.y, point.z, observation.x, observation.y, observation.visibility].every(Number.isFinite)) return 'invalid_landmarks';
    if (observation.visibility < 0.65 || (Number.isFinite(observation.presence) && observation.presence < 0.65) || observation.x < 0 || observation.x > 1 || observation.y < 0 || observation.y > 1) return 'occluded_or_outside';
    return null;
  };
  for (const index of required) {
    const problem = landmarkProblem(index);
    if (problem) return invalid(problem);
  }
  const scale = magnitude(subtract(world[11], world[12]));
  if (scale < 0.12 || scale > 0.8) return invalid('unstable_body_scale');
  const lateral = normalize(subtract(world[11], world[12]));
  const torso = {
    x: (world[23].x + world[24].x - world[11].x - world[12].x) / 2,
    y: (world[23].y + world[24].y - world[11].y - world[12].y) / 2,
    z: (world[23].z + world[24].z - world[11].z - world[12].z) / 2,
  };
  const backward = normalize(cross(lateral, torso));
  if (!backward) return invalid('unstable_torso_basis');
  const downward = normalize(cross(backward, lateral));
  const imageShoulderWidth = Math.hypot(image[11].x - image[12].x, image[11].y - image[12].y);
  const imageTorsoHeight = Math.hypot((image[23].x + image[24].x - image[11].x - image[12].x) / 2, (image[23].y + image[24].y - image[11].y - image[12].y) / 2);
  const imageBodyScale = Math.max(imageShoulderWidth, imageTorsoHeight * 0.5);
  if (imageBodyScale < 0.025) return invalid('unstable_image_scale');
  const arms = {};
  const armProblems = {};
  for (const [hand, shoulderIndex, elbowIndex, wristIndex] of [['left', 11, 13, 15], ['right', 12, 14, 16]]) {
    const problem = landmarkProblem(elbowIndex) || landmarkProblem(wristIndex);
    if (problem) { armProblems[hand] = problem; continue; }
    const wrist = world[wristIndex];
    const shoulder = world[shoulderIndex];
    const relative = subtract(wrist, shoulder);
    const angle = elbowAngle(shoulder, world[elbowIndex], wrist);
    if (!Number.isFinite(angle)) { armProblems[hand] = 'degenerate_arm'; continue; }
    arms[hand] = {
      position: { x: dot(relative, lateral) / scale, y: dot(relative, downward) / scale, z: dot(relative, backward) / scale },
      elbowAngle: angle,
      confidence: Math.min(...[shoulderIndex, elbowIndex, wristIndex].map(index => image[index].visibility)),
      guard: magnitude(subtract(wrist, world[0])) / scale < 0.95 && dot(relative, downward) < scale * 0.2,
    };
    if (Number.isFinite(result.width) && result.width > 0 && Number.isFinite(result.height) && result.height > 0) {
      const [projectedShoulder, projectedElbow, projectedWrist] = [shoulderIndex, elbowIndex, wristIndex].map(index => ({x:image[index].x * result.width,y:image[index].y * result.height,z:0}));
      const upper = magnitude(subtract(projectedElbow, projectedShoulder));
      const lower = magnitude(subtract(projectedWrist, projectedElbow));
      if (Math.min(upper, lower) >= result.height * 0.025) arms[hand].projected = {
        angle: elbowAngle(projectedShoulder, projectedElbow, projectedWrist),
        reach: magnitude(subtract(projectedWrist, projectedShoulder)) / (upper + lower),
      };
    }
  }
  if (!Object.keys(arms).length) return invalid(Object.values(armProblems)[0]);
  if (arms.left && arms.right && Math.hypot(image[15].x - image[16].x, image[15].y - image[16].y) < imageBodyScale * 0.12) return invalid('overlapping_hands');
  return { timestamp: result.timestamp, valid: true, complete: Boolean(arms.left && arms.right), arms, armProblems, scale, estimatedDepth: true };
}
