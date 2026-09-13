function emptyActionCounts() {
  return Object.fromEntries(ACTION_TYPES.map(([key]) => [key, 0]));
}

function emptyActionFeedback() {
  return Object.fromEntries(ACTION_TYPES.map(([key]) => [key, []]));
}

function startFeedbackSession(member = currentTrainingMember()) {
  state.feedbackWindow = newFeedbackWindow();
  state.sessionFeedback = {
    startedAt: Date.now(),
    windows: [],
    actionCounts: emptyActionCounts(),
    actionFeedback: emptyActionFeedback(),
    lastActionAt: {},
    recentActions: [],
    instructionScores: [],
  };
  state.lastMotionSample = null;
  state.cameraMotionHistories = {};
  state.lastCameraMotionSamples = {};
  state.punchLock = null;
  selectNextTrainingInstruction(member);
}

function clearFeedbackSession() {
  state.feedbackWindow = null;
  state.sessionFeedback = null;
  resetTrainingInstruction();
  state.lastMotionSample = null;
  state.motionHistory = [];
  state.cameraMotionHistories = {};
  state.lastCameraMotionSamples = {};
  state.punchLock = null;
}

function resetTrainingInstruction() {
  state.currentInstruction = null;
  state.currentInstructionProgress = 0;
  state.currentInstructionStartedAt = 0;
  state.currentInstructionQuality = {};
}

function selectNextTrainingInstruction(member = currentTrainingMember()) {
  const level = memberTrainingLevel(member);
  const pool = LEVEL_ACTIONS[level] || LEVEL_ACTIONS[1];
  const previous = state.currentInstruction?.text || "";
  const candidates = pool.length > 1 ? pool.filter((item) => item.text !== previous) : pool;
  const selected = candidates[Math.floor(Math.random() * candidates.length)] || pool[0];
  state.currentInstruction = { ...selected, level };
  state.currentInstructionProgress = 0;
  state.currentInstructionStartedAt = Date.now();
  state.currentInstructionQuality = {};
  return state.currentInstruction;
}

function currentInstructionText(fallback = "") {
  return state.currentInstruction?.text || fallback;
}

function matchedInstructionEvents(instruction, events) {
  const checks = new Set(instruction?.checks || []);
  if (!checks.size) return 0;
  return events.filter((event) => checks.has(event.type)).length;
}

function maybeAdvanceTrainingInstruction(packet, events) {
  const instruction = state.currentInstruction;
  if (!state.activeSessionId || !instruction || packet.status === "no_person") return;
  const elapsed = Date.now() - state.currentInstructionStartedAt;
  if (elapsed < INSTRUCTION_MIN_HOLD_MS) return;
  trackInstructionQuality(instruction, events);
  state.currentInstructionProgress += matchedInstructionEvents(instruction, events);
  const required = Math.max(1, Number(instruction.required || 1));
  const scoreReady = currentInstructionAccuracy(instruction) >= INSTRUCTION_CONFIRM_SCORE;
  const isOpenDrill = /프리 콤비네이션/.test(instruction.text);
  const hasEnoughEvents = state.currentInstructionProgress >= required && instructionCoverageReady(instruction);
  const openDrillReady = isOpenDrill && scoreReady && state.currentInstructionProgress > 0 && elapsed >= 2500;
  if (!hasEnoughEvents && !openDrillReady) return;
  recordInstructionScore(instruction);
  const next = selectNextTrainingInstruction(currentTrainingMember());
  $("#targetAction").textContent = next.text;
}

function trackInstructionQuality(instruction, events) {
  const checks = new Set(instruction?.checks || []);
  events.forEach((event) => {
    if (!checks.has(event.type)) return;
    state.currentInstructionQuality[event.type] = Math.max(
      state.currentInstructionQuality[event.type] || 0,
      Number(event.quality || 0),
    );
  });
}

function instructionCoverageReady(instruction) {
  const expected = [...new Set(instruction?.checks || [])];
  if (!expected.length) return true;
  return expected.every((type) => Number(state.currentInstructionQuality[type] || 0) > 0);
}

function currentInstructionAccuracy(instruction) {
  const expected = [...new Set(instruction?.checks || [])];
  if (!expected.length) return 0;
  const qualityAverage = expected.reduce((sum, type) => sum + Number(state.currentInstructionQuality[type] || 0), 0) / expected.length;
  const required = Math.max(1, Number(instruction.required || expected.length || 1));
  const completion = Math.min(1, state.currentInstructionProgress / required) * 100;
  return clampScore(qualityAverage * 0.8 + completion * 0.2);
}

function recordInstructionScore(instruction) {
  if (!state.sessionFeedback) return;
  const score = currentInstructionAccuracy(instruction);
  state.sessionFeedback.instructionScores.push({
    instruction: instruction.text,
    level: instruction.level,
    score,
    completedAt: Date.now(),
  });
}

function sessionAverageInstructionScore() {
  const scores = state.sessionFeedback?.instructionScores || [];
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, item) => sum + Number(item.score || 0), 0) / scores.length);
}

function sessionScoreLabel() {
  const score = sessionAverageInstructionScore();
  return score ? String(score) : "--";
}

function newFeedbackWindow() {
  return {
    startedAt: Date.now(),
    packets: [],
    events: [],
    feedbackTexts: [],
  };
}

function ingestPoseFeedback(packet) {
  if (!state.sessionFeedback) return [];
  if (!state.feedbackWindow) state.feedbackWindow = newFeedbackWindow();
  const events = detectMotionEvents(packet);
  state.feedbackWindow.packets.push(packet);
  state.feedbackWindow.events.push(...events);
  (packet.feedback_log || fallbackFeedbackLog(packet)).forEach((item) => {
    if (item.text) state.feedbackWindow.feedbackTexts.push(item.text);
  });
  events.forEach((event) => recordMotionEvent(event, packet));
  if (Date.now() - state.feedbackWindow.startedAt >= FEEDBACK_WINDOW_MS) flushFeedbackWindow();
  return events;
}

function recordMotionEvent(event, packet) {
  const session = state.sessionFeedback;
  if (!session) return;
  session.actionCounts[event.type] = (session.actionCounts[event.type] || 0) + 1;
  session.recentActions.push({ ...event, at: packet.timestamp });
  session.recentActions = session.recentActions.filter((item) => packet.timestamp - item.at <= 2);
  const feedback = actionFeedbackText(event.type, packet.metrics);
  const bucket = session.actionFeedback[event.type] || [];
  if (!bucket.includes(feedback)) bucket.push(feedback);
  session.actionFeedback[event.type] = bucket.slice(0, 3);
  if (
    event.type === "right"
    && session.recentActions.some((item) => item.type === "jab" && event.at - item.at > 0 && event.at - item.at <= 1.2)
    && canRecordMotion("oneTwo", event.at)
  ) {
    recordMotionEvent({ type: "oneTwo", at: event.at }, packet);
  }
}

function flushFeedbackWindow(force = false) {
  const windowData = state.feedbackWindow;
  if (!windowData || (!force && Date.now() - windowData.startedAt < FEEDBACK_WINDOW_MS)) return;
  if (!windowData.packets.length) {
    state.feedbackWindow = newFeedbackWindow();
    return;
  }
  const summary = summarizeFeedbackWindow(windowData);
  state.sessionFeedback?.windows.push(summary);
  $("#feedbackText").textContent = summary.text;
  renderFeedbackLog(summary.logs);
  speakFeedback(summary.text);
  state.feedbackWindow = newFeedbackWindow();
}

function summarizeFeedbackWindow(windowData) {
  const packets = windowData.packets;
  const averaged = averageMetrics(packets.map((packet) => packet.metrics));
  const score = Math.round(packets.reduce((total, packet) => total + Number(packet.score || 0), 0) / packets.length);
  const eventCounts = countEvents(windowData.events);
  const topEvent = Object.entries(eventCounts).sort((a, b) => b[1] - a[1])[0];
  const focusText = weakestFeedbackText(averaged);
  const actionText = topEvent ? `${actionLabel(topEvent[0])} ${topEvent[1]}회. ` : "";
  const text = `${actionText}${focusText}`;
  return {
    startedAt: windowData.startedAt,
    endedAt: Date.now(),
    score,
    metrics: averaged,
    actionCounts: eventCounts,
    text,
    logs: [
      { text },
      { text: `가드 ${averaged.guard} · 펀치 회수 ${averaged.punch} · 자세 ${averaged.posture}` },
    ],
  };
}

function countEvents(events) {
  const counts = {};
  events.forEach((event) => {
    counts[event.type] = (counts[event.type] || 0) + 1;
  });
  return counts;
}

function averageMetrics(metricsItems) {
  const keys = ["guard", "punch", "posture", "left_guard", "right_guard", "extension", "left_extension", "right_extension"];
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  metricsItems.forEach((metrics) => {
    keys.forEach((key) => {
      totals[key] += Number(metrics?.[key] || 0);
    });
  });
  const count = Math.max(1, metricsItems.length);
  return Object.fromEntries(keys.map((key) => [key, Math.round(totals[key] / count)]));
}

function weakestFeedbackText(metrics) {
  const candidates = [
    [metrics.guard, guardFeedback(metrics.left_guard, metrics.right_guard)],
    [metrics.punch, punchFeedback(metrics.extension, metrics.guard)],
    [metrics.posture, postureFeedback(metrics.posture)],
  ].sort((a, b) => a[0] - b[0]);
  return candidates[0][1];
}

function actionLabel(type) {
  return ACTION_TYPES.find(([key]) => key === type)?.[1] || type;
}

function actionFeedbackText(type, metrics) {
  const guard = guardFeedback(metrics.left_guard, metrics.right_guard);
  const punch = punchFeedback(metrics.extension, metrics.guard);
  const posture = postureFeedback(metrics.posture);
  const feedback = {
    jab: `잽 후 앞손 복귀를 확인하세요. ${guard}`,
    right: `라이트 후 반대손 가드를 유지하세요. ${guard}`,
    oneTwo: `원투 리듬은 좋습니다. 두 번째 펀치 뒤 회수를 빠르게 가져가세요.`,
    hook: `훅은 팔만 돌리지 말고 어깨와 골반 회전을 같이 쓰세요. ${posture}`,
    upper: `어퍼는 중심이 뜨지 않게 무릎 반동을 짧게 쓰세요. ${posture}`,
    duck: `더킹 뒤 시선과 가드를 바로 복구하세요. ${guard}`,
    weave: `위빙은 상체만 크게 흔들기보다 무릎으로 낮게 지나가세요. ${posture}`,
  };
  return feedback[type] || punch;
}

function englishActionFeedbackText(type) {
  const feedback = {
    jab: "Bring your lead hand back to guard right after the jab.",
    right: "Keep the opposite hand high after the right hand.",
    oneTwo: "Good one-two rhythm. Recover quickly after the second punch.",
    hook: "Turn the shoulder and hips together. Do not swing with the arm only.",
    upper: "Stay grounded and use a short knee drive on the uppercut.",
    duck: "Recover your eyes and guard immediately after the duck.",
    weave: "Use your knees and move under the line instead of only leaning your upper body.",
  };
  return feedback[type] || "Keep your guard high and recover the punch quickly.";
}

function localizedFeedbackText(text) {
  if (voiceLanguage() !== "en-US") return text;
  const currentWindow = state.sessionFeedback?.windows?.at(-1);
  const topEvent = currentWindow
    ? Object.entries(currentWindow.actionCounts || {}).sort((a, b) => b[1] - a[1])[0]
    : null;
  if (topEvent?.[0]) return englishActionFeedbackText(topEvent[0]);
  return "Keep your guard high and recover your punches quickly.";
}

function detectMotionEvents(packet) {
  const points = Object.fromEntries((packet.keypoints || []).map((point) => [point.name, point]));
  const rawSample = motionSample(points, packet.timestamp);
  const current = smoothedMotionSample(rawSample);
  const previous = state.lastMotionSample;
  state.lastMotionSample = current;
  if (!previous || packet.status === "no_person" || !current.trackable) return [];
  const events = [];
  const addEvent = (type, quality = 0) => {
    const at = Date.now();
    if (canRecordMotion(type, at)) events.push({ type, at: packet.timestamp, quality: clampScore(quality) });
  };
  const twoCameraPunch = classifyTwoCameraPunch(packet);
  if (twoCameraPunch) {
    addEvent(twoCameraPunch.type, twoCameraPunch.quality);
  } else {
    const singleCameraPunch = classifySingleCameraPunch(current, previous);
    if (singleCameraPunch) addEvent(singleCameraPunch.type, singleCameraPunch.quality);
  }
  const duckQuality = duckAccuracy(current, previous);
  const weaveQuality = weaveAccuracy(current, previous);
  if (duckQuality > 0) addEvent("duck", duckQuality);
  if (weaveQuality > 0) addEvent("weave", weaveQuality);
  return events;
}

function canRecordMotion(type, at) {
  const lastAt = state.sessionFeedback?.lastActionAt[type] || 0;
  if (at - lastAt < MOTION_EVENT_COOLDOWN_MS) return false;
  state.sessionFeedback.lastActionAt[type] = at;
  return true;
}

function motionSample(points, timestamp) {
  const leftShoulder = points.left_shoulder || {};
  const rightShoulder = points.right_shoulder || {};
  const leftWrist = points.left_wrist || {};
  const rightWrist = points.right_wrist || {};
  const leftElbow = points.left_elbow || {};
  const rightElbow = points.right_elbow || {};
  const nose = points.nose || {};
  const useWorld = worldPointsAvailable([leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist]);
  const shoulderSpan = useWorld
    ? Math.max(distance3d(leftShoulder, rightShoulder), 0.05)
    : Math.max(Math.abs((rightShoulder.x || 0) - (leftShoulder.x || 0)), 0.1);
  const leftExtension2d = useWorld ? punchExtension3d(leftWrist, leftShoulder, shoulderSpan) : punchExtension(leftWrist, leftShoulder, shoulderSpan);
  const rightExtension2d = useWorld ? punchExtension3d(rightWrist, rightShoulder, shoulderSpan) : punchExtension(rightWrist, rightShoulder, shoulderSpan);
  const leftStraightness = elbowStraightnessScore(leftShoulder, leftElbow, leftWrist);
  const rightStraightness = elbowStraightnessScore(rightShoulder, rightElbow, rightWrist);
  const leftDepth = Number(leftWrist.depth_forward || 0);
  const rightDepth = Number(rightWrist.depth_forward || 0);
  const leftExtension = leftDepth > 0 ? clampScore(leftExtension2d * 0.38 + leftDepth * 0.62) : leftExtension2d;
  const rightExtension = rightDepth > 0 ? clampScore(rightExtension2d * 0.38 + rightDepth * 0.62) : rightExtension2d;
  const activePunchSide = leftWrist.depth_active ? "left" : rightWrist.depth_active ? "right" : "";
  const leftReliability = averageVisibility([leftShoulder, leftElbow, leftWrist]);
  const rightReliability = averageVisibility([rightShoulder, rightElbow, rightWrist]);
  const bodyReliability = averageVisibility([nose, leftShoulder, rightShoulder]);
  return {
    timestamp,
    leftExtension,
    rightExtension,
    extension: Math.max(leftExtension, rightExtension),
    leftDepth,
    rightDepth,
    activePunchSide,
    leftX: axisValue(leftWrist, "x", useWorld),
    rightX: axisValue(rightWrist, "x", useWorld),
    leftY: axisValue(leftWrist, "y", useWorld),
    rightY: axisValue(rightWrist, "y", useWorld),
    noseY: axisValue(points.nose || {}, "y", useWorld),
    shoulderY: (axisValue(leftShoulder, "y", useWorld) + axisValue(rightShoulder, "y", useWorld)) / 2,
    shoulderCenterX: (axisValue(leftShoulder, "x", useWorld) + axisValue(rightShoulder, "x", useWorld)) / 2,
    leftReliability,
    rightReliability,
    bodyReliability,
    leftStraightness,
    rightStraightness,
    useWorld,
    trackable: bodyReliability >= 0.42 && (leftReliability >= 0.36 || rightReliability >= 0.36),
  };
}

function averageVisibility(points) {
  const scores = points.map((point) => Number(point.score || 0)).filter((score) => score > 0);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

function smoothedMotionSample(sample) {
  state.motionHistory.push(sample);
  state.motionHistory = state.motionHistory.filter((item) => sample.timestamp - item.timestamp <= 0.45).slice(-8);
  const keys = [
    "leftExtension", "rightExtension", "extension", "leftX", "rightX", "leftY", "rightY",
    "leftDepth", "rightDepth", "noseY", "shoulderY", "shoulderCenterX", "leftReliability", "rightReliability", "bodyReliability",
    "leftStraightness", "rightStraightness",
  ];
  const smoothed = { ...sample };
  keys.forEach((key) => {
    smoothed[key] = state.motionHistory.reduce((sum, item) => sum + Number(item[key] || 0), 0) / state.motionHistory.length;
  });
  smoothed.trackable = sample.trackable;
  smoothed.activePunchSide = sample.activePunchSide;
  return smoothed;
}

function classifyTwoCameraPunch(packet) {
  const samples = cameraMotionSamples(packet);
  if (samples.length < 2) return null;
  const sideSample = bestCameraSample(samples, (observation) => isSideView(observation.view_angle));
  const frontSample = bestCameraSample(samples, (observation) => isFrontView(observation.view_angle))
    || bestCameraSample(samples, (observation) => !isSideView(observation.view_angle));
  const candidates = [];
  if (sideSample?.previous?.trackable && sideSample.current.trackable) {
    ["left", "right"].forEach((side) => {
      const straight = sideViewStraightCandidate(sideSample.current, sideSample.previous, side);
      const upper = sideViewUpperCandidate(sideSample.current, sideSample.previous, side);
      if (straight) candidates.push(straight);
      if (upper) candidates.push(upper);
    });
  }
  if (frontSample?.previous?.trackable && frontSample.current.trackable) {
    const hook = frontViewHookCandidate(frontSample.current, frontSample.previous);
    if (hook) candidates.push(hook);
  }
  const ranked = candidates
    .filter((candidate) => candidate.score >= TWO_CAMERA_PUNCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  const second = ranked[1];
  if (second && best.score - second.score < TWO_CAMERA_PUNCH_MARGIN) return null;
  return { type: best.type, quality: best.quality || best.score };
}

function cameraMotionSamples(packet) {
  const observations = Array.isArray(packet.multi_camera_observations) ? packet.multi_camera_observations : [];
  if (observations.length < 2) return [];
  return observations
    .filter((observation) => averageKeypointScore(observation.keypoints || []) >= 0.35)
    .map((observation) => {
      const current = smoothedCameraMotionSample(observation);
      const key = cameraSampleKey(observation);
      const previous = state.lastCameraMotionSamples[key] || null;
      state.lastCameraMotionSamples[key] = current;
      return { observation, current, previous };
    });
}

function smoothedCameraMotionSample(observation) {
  const key = cameraSampleKey(observation);
  const sample = motionSample(pointsByName(observation.keypoints || []), observation.timestamp || Date.now() / 1000);
  const history = state.cameraMotionHistories[key] || [];
  const nextHistory = [...history, sample].filter((item) => sample.timestamp - item.timestamp <= 0.45).slice(-8);
  state.cameraMotionHistories[key] = nextHistory;
  const keys = [
    "leftExtension", "rightExtension", "extension", "leftX", "rightX", "leftY", "rightY",
    "leftDepth", "rightDepth", "noseY", "shoulderY", "shoulderCenterX", "leftReliability", "rightReliability", "bodyReliability",
    "leftStraightness", "rightStraightness",
  ];
  const smoothed = { ...sample };
  keys.forEach((itemKey) => {
    smoothed[itemKey] = nextHistory.reduce((sum, item) => sum + Number(item[itemKey] || 0), 0) / nextHistory.length;
  });
  smoothed.trackable = sample.trackable;
  smoothed.activePunchSide = sample.activePunchSide;
  return smoothed;
}

function cameraSampleKey(observation) {
  return observation.camera_id || observation.view_angle || "camera";
}

function bestCameraSample(samples, predicate) {
  return samples
    .filter((sample) => predicate(sample.observation))
    .sort((a, b) => averageKeypointScore(b.observation.keypoints || []) - averageKeypointScore(a.observation.keypoints || []))[0] || null;
}

function isSideView(viewAngle = "") {
  return String(viewAngle).includes("side");
}

function isFrontView(viewAngle = "") {
  return String(viewAngle).includes("front");
}

function sideViewStraightCandidate(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const forwardGain = extension - previous[`${prefix}Extension`];
  const rise = previous[`${prefix}Y`] - current[`${prefix}Y`];
  const heightDelta = Math.abs(current[`${prefix}Y`] - current.shoulderY);
  if (reliability < 0.42 || extension < 62 || forwardGain < 8 || heightDelta > 0.28) return null;
  const heightScore = clampScore(100 - heightDelta * 300);
  const gainScore = clampScore((forwardGain / 22) * 100);
  const risePenalty = Math.max(0, rise - 0.035) * 520;
  const score = clampScore(
    extension * 0.38
      + gainScore * 0.24
      + current[`${prefix}Straightness`] * 0.18
      + heightScore * 0.12
      + reliability * 10
      - risePenalty,
  );
  return { type: side === "left" ? "jab" : "right", score, quality: score };
}

function sideViewUpperCandidate(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const forwardGain = extension - previous[`${prefix}Extension`];
  const rise = previous[`${prefix}Y`] - current[`${prefix}Y`];
  const startedLow = previous[`${prefix}Y`] >= previous.shoulderY - 0.03;
  if (reliability < 0.42 || rise < 0.028 || extension < 30 || extension > 82) return null;
  const riseScore = clampScore((rise / 0.075) * 100);
  const extensionShape = clampScore(100 - Math.abs(extension - 54) * 2.3);
  const lowStartScore = startedLow ? 100 : 58;
  const forwardPenalty = Math.max(0, forwardGain - 24) * 1.35;
  const score = clampScore(
    riseScore * 0.50
      + extensionShape * 0.21
      + lowStartScore * 0.14
      + reliability * 13
      - forwardPenalty,
  );
  return { type: "upper", score, quality: score };
}

function frontViewHookCandidate(current, previous) {
  const score = hookAccuracy(current, previous);
  return score ? { type: "hook", score, quality: score } : null;
}

function classifySingleCameraPunch(current, previous) {
  const candidates = ["left", "right"].flatMap((side) => [
    singleCameraStraightCandidate(current, previous, side),
    singleCameraHookCandidate(current, previous, side),
    singleCameraUpperCandidate(current, previous, side),
  ]).filter(Boolean);
  const ranked = candidates
    .filter((candidate) => candidate.score >= SINGLE_CAMERA_PUNCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0];
  const second = ranked[1];
  if (second && best.score - second.score < SINGLE_CAMERA_PUNCH_MARGIN) return null;
  if (best.kind === "straight") {
    if (state.punchLock && Date.now() < state.punchLock.until && state.punchLock.side !== best.side) return null;
    state.punchLock = { side: best.side, until: Date.now() + 330 };
  }
  return { type: best.type, quality: best.score };
}

function singleCameraStraightCandidate(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const extensionGain = extension - previous[`${prefix}Extension`];
  const depth = current[`${prefix}Depth`] || 0;
  const depthGain = depth - (previous[`${prefix}Depth`] || 0);
  const wristY = current[`${prefix}Y`];
  const rise = previous[`${prefix}Y`] - wristY;
  const lateral = Math.abs(current[`${prefix}X`] - previous[`${prefix}X`]);
  const depthAssistActive = current.activePunchSide;
  const heightDelta = Math.abs(wristY - current.shoulderY);
  if (reliability < 0.42) return null;
  if (extension < 66 && depth < 58) return null;
  if (extensionGain < 9 && depthGain < 8) return null;
  if (depthAssistActive && depthAssistActive !== side) return null;
  if (heightDelta > 0.20) return null;
  if (rise > 0.055 && rise > lateral * 0.8) return null;
  if (lateral > 0.105 && lateral > Math.abs(rise) * 1.45 && extension < 76) return null;
  const heightScore = clampScore(100 - heightDelta * 340);
  const gainScore = clampScore(Math.max(extensionGain * 4.1, depthGain * 5.2));
  const score = clampScore(
    extension * 0.40
      + gainScore * 0.23
      + current[`${prefix}Straightness`] * 0.19
      + heightScore * 0.12
      + reliability * 10
      - Math.max(0, rise - 0.030) * 420
      - Math.max(0, lateral - 0.080) * 160,
  );
  return { type: side === "left" ? "jab" : "right", kind: "straight", side, score, quality: score };
}

function straightPunchAccuracy(current, previous, side) {
  return singleCameraStraightCandidate(current, previous, side)?.score || 0;
}

function hookAccuracy(current, previous) {
  return Math.max(
    sideHookAccuracy(current, previous, "left"),
    sideHookAccuracy(current, previous, "right"),
  );
}

function sideHookAccuracy(current, previous, side) {
  return singleCameraHookCandidate(current, previous, side)?.score || 0;
}

function singleCameraHookCandidate(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const swing = Math.abs(current[`${prefix}X`] - previous[`${prefix}X`]);
  const vertical = Math.abs(current[`${prefix}Y`] - previous[`${prefix}Y`]);
  const extensionGain = Math.max(0, extension - previous[`${prefix}Extension`]);
  const heightDelta = Math.abs(current[`${prefix}Y`] - current.shoulderY);
  const straightness = current[`${prefix}Straightness`];
  if (reliability < 0.42 || swing < 0.034 || extension < 34 || extension > 84) return null;
  if (heightDelta > 0.30) return null;
  if (vertical > swing * 1.35 && vertical > 0.030) return null;
  if (extensionGain > 24 && straightness > 72 && swing < 0.090) return null;
  const extensionShape = clampScore(100 - Math.abs(extension - 58) * 2.7);
  const swingScore = clampScore((swing / 0.075) * 100);
  const bendScore = clampScore(100 - Math.max(0, straightness - 72) * 2.0);
  const heightScore = clampScore(100 - heightDelta * 260);
  const score = clampScore(
    swingScore * 0.42
      + extensionShape * 0.24
      + bendScore * 0.13
      + heightScore * 0.10
      + reliability * 11
      - Math.max(0, vertical - swing * 0.75) * 360
      - Math.max(0, extensionGain - 20) * 0.9,
  );
  return { type: "hook", kind: "hook", side, score, quality: score };
}

function uppercutAccuracy(current, previous) {
  return Math.max(
    sideUppercutAccuracy(current, previous, "left"),
    sideUppercutAccuracy(current, previous, "right"),
  );
}

function sideUppercutAccuracy(current, previous, side) {
  return singleCameraUpperCandidate(current, previous, side)?.score || 0;
}

function singleCameraUpperCandidate(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const rise = previous[`${prefix}Y`] - current[`${prefix}Y`];
  const lateral = Math.abs(current[`${prefix}X`] - previous[`${prefix}X`]);
  const extensionGain = Math.max(0, extension - previous[`${prefix}Extension`]);
  const startedLow = previous[`${prefix}Y`] >= previous.shoulderY - 0.025;
  const finishNearLine = current[`${prefix}Y`] <= current.shoulderY + 0.12;
  if (reliability < 0.42 || rise < 0.028 || extension < 30 || extension > 80) return null;
  if (!startedLow && rise < 0.055) return null;
  if (!finishNearLine) return null;
  if (lateral > Math.max(0.075, rise * 1.35)) return null;
  if (extensionGain > 28 && current[`${prefix}Straightness`] > 72) return null;
  const extensionShape = clampScore(100 - Math.abs(extension - 54) * 2.5);
  const riseScore = clampScore((rise / 0.07) * 100);
  const lowStartScore = startedLow ? 100 : 62;
  const verticalDominance = clampScore((rise / Math.max(lateral, 0.018)) * 48);
  const score = clampScore(
    riseScore * 0.43
      + extensionShape * 0.20
      + lowStartScore * 0.13
      + verticalDominance * 0.10
      + reliability * 12
      - Math.max(0, lateral - rise * 0.80) * 330
      - Math.max(0, extensionGain - 18) * 0.7,
  );
  return { type: "upper", kind: "upper", side, score, quality: score };
}

function duckAccuracy(current, previous) {
  const drop = current.noseY - previous.noseY;
  const drift = Math.abs(current.shoulderCenterX - previous.shoulderCenterX);
  if (current.bodyReliability < 0.5 || drop < 0.035 || drift > 0.035) return 0;
  const dropScore = clampScore((drop / 0.09) * 100);
  const stabilityScore = clampScore(100 - drift * 1800);
  return clampScore(dropScore * 0.62 + stabilityScore * 0.2 + current.bodyReliability * 18);
}

function weaveAccuracy(current, previous) {
  const lateral = Math.abs(current.shoulderCenterX - previous.shoulderCenterX);
  if (current.bodyReliability < 0.5 || current.noseY <= current.shoulderY - 0.05 || lateral < 0.035) return 0;
  const lateralScore = clampScore((lateral / 0.085) * 100);
  const lowHeadScore = clampScore((current.noseY - (current.shoulderY - 0.05)) * 900);
  return clampScore(lateralScore * 0.54 + lowHeadScore * 0.28 + current.bodyReliability * 18);
}

function buildSessionFeedbackReport(sessionId, score) {
  const session = state.sessionFeedback || {
    startedAt: Date.now(),
    windows: [],
    actionCounts: emptyActionCounts(),
    actionFeedback: emptyActionFeedback(),
  };
  const counts = { ...emptyActionCounts(), ...session.actionCounts };
  const feedback = { ...emptyActionFeedback(), ...session.actionFeedback };
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    score,
    durationSeconds: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)),
    actionCounts: counts,
    actionFeedback: feedback,
    instructionScores: session.instructionScores || [],
    windows: session.windows || [],
    summary: buildSessionSummaryText(counts, feedback, session.instructionScores || []),
    summary_en: buildEnglishSessionSummaryText(counts, feedback),
  };
}

function buildSessionSummaryText(counts, feedback, instructionScores = []) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const top = ACTION_TYPES
    .map(([key, label]) => ({ key, label, count: counts[key] || 0 }))
    .sort((a, b) => b.count - a.count)[0];
  const main = top && top.count ? `${top.label}이 가장 많이 감지되었습니다(${top.count}회).` : "감지된 주요 동작이 아직 없습니다.";
  const average = instructionScores.length
    ? `동작 수행률 평균 ${Math.round(instructionScores.reduce((sum, item) => sum + Number(item.score || 0), 0) / instructionScores.length)}점. `
    : "";
  const firstFeedback = ACTION_TYPES.map(([key]) => feedback[key]?.[0]).find(Boolean) || "다음 라운드에서는 가드 유지와 펀치 회수를 우선 확인하세요.";
  return `총 ${total}회 동작 감지. ${average}${main} ${firstFeedback}`;
}

function buildEnglishSessionSummaryText(counts, feedback) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const top = ACTION_TYPES
    .map(([key, label]) => ({ key, label, count: counts[key] || 0 }))
    .sort((a, b) => b.count - a.count)[0];
  const main = top && top.count
    ? `${top.label} was detected most often, ${top.count} times.`
    : "No clear main action was detected yet.";
  const firstKey = ACTION_TYPES.map(([key]) => feedback[key]?.length ? key : "").find(Boolean);
  const firstFeedback = firstKey ? englishActionFeedbackText(firstKey) : "Focus on keeping your guard high and recovering punches quickly.";
  return `${total} actions detected. ${main} ${firstFeedback}`;
}

function parseFeedbackReport(session) {
  if (!session?.feedback_report) return null;
  try {
    return JSON.parse(session.feedback_report);
  } catch {
    return null;
  }
}

function showSessionFeedbackModal(report) {
  document.querySelector("#sessionFeedbackModal")?.remove();
  const totalActions = Object.values(report.actionCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  const averageScore = report.instructionScores?.length
    ? Math.round(report.instructionScores.reduce((sum, item) => sum + Number(item.score || 0), 0) / report.instructionScores.length)
    : Number(report.score || 0);
  const modal = document.createElement("div");
  modal.id = "sessionFeedbackModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="confirm-modal session-feedback-modal">
      <header class="session-feedback-heading">
        <div>
          <span class="session-feedback-eyebrow">ROUND COMPLETE / AI COACH</span>
          <strong>라운드 피드백</strong>
        </div>
        <div class="session-feedback-stats" aria-label="라운드 요약">
          <span><small>수행 점수</small><b>${averageScore}</b></span>
          <span><small>감지 동작</small><b>${totalActions}</b></span>
          <span><small>운동 시간</small><b>${formatSeconds(report.durationSeconds || 0)}</b></span>
        </div>
        <button type="button" class="ghost session-feedback-close" id="closeSessionFeedback" aria-label="라운드 피드백 닫기">×</button>
      </header>
      <div class="session-feedback-layout">
        <section class="feedback-voice-stage" aria-labelledby="feedbackVoiceTitle">
          <div class="feedback-voice-status"><i></i> JARVIS VOICE CORE ONLINE</div>
          ${jarvisHudInterface()}
          <div class="feedback-voice-copy">
            <span id="feedbackVoiceTitle">음성 분석 코어가 준비됐습니다</span>
            <p>AI 코치가 말할 때 링과 중앙 코어가 음성 강도에 맞춰 반응합니다.</p>
          </div>
          <button type="button" class="feedback-replay-button" id="replaySessionFeedback"><span aria-hidden="true">▶</span> 피드백 다시 듣기</button>
        </section>
        <section class="feedback-conversation" aria-label="AI 코치 피드백 대화">
          <div class="feedback-conversation-head">
            <div>
              <span>AI VOICE COACH</span>
              <strong>이번 라운드에서 발견한 포인트예요</strong>
            </div>
            <span class="feedback-layout-badge">VOICE READY</span>
          </div>
          <div class="feedback-chat-thread">
            <article class="feedback-coach-message">
              <div class="feedback-coach-avatar">AI</div>
              <div>
                <span>코치 분석</span>
                <p>${escapeHtml(report.summary)}</p>
              </div>
            </article>
            ${sessionFeedbackTable(report)}
          </div>
          <div class="feedback-voice-dialogue" aria-label="음성 대화 인터페이스">
            <div class="feedback-voice-wave" aria-hidden="true">${feedbackVoiceBars()}</div>
            <button type="button" class="feedback-mic-button" disabled aria-label="음성 대화 시작">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"></path></svg>
            </button>
            <div>
              <span>VOICE DIALOGUE</span>
              <strong>AI 코치에게 말로 질문하세요</strong>
              <small>음성 인식·대화 연결 예정</small>
            </div>
          </div>
          <div class="session-feedback-actions">
            <button id="downloadLatestFeedbackCsv">피드백 저장</button>
            <button type="button" class="ghost" id="closeSessionFeedbackFooter">닫기</button>
          </div>
        </section>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const startVoiceAnimation = () => startSessionFeedbackVoiceAnimation(modal);
  const pulseVoiceAnimation = (event) => pulseSessionFeedbackVoiceBoundary(modal, event.detail);
  const stopVoiceAnimation = () => stopSessionFeedbackVoiceAnimation(modal);
  window.addEventListener("boxing-voice-start", startVoiceAnimation);
  window.addEventListener("boxing-voice-boundary", pulseVoiceAnimation);
  window.addEventListener("boxing-voice-end", stopVoiceAnimation);
  const closeModal = () => {
    window.speechSynthesis?.cancel();
    stopSessionFeedbackVoiceAnimation(modal);
    window.removeEventListener("boxing-voice-start", startVoiceAnimation);
    window.removeEventListener("boxing-voice-boundary", pulseVoiceAnimation);
    window.removeEventListener("boxing-voice-end", stopVoiceAnimation);
    modal.remove();
  };
  $("#downloadLatestFeedbackCsv").addEventListener("click", () => downloadFeedbackCsv(report));
  $("#replaySessionFeedback").addEventListener("click", () => {
    speakText(sessionSummaryForVoice(report), true);
  });
  [$("#closeSessionFeedback"), $("#closeSessionFeedbackFooter")].forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  speakText(sessionSummaryForVoice(report));
}

function startSessionFeedbackVoiceAnimation(modal) {
  const hud = modal.querySelector(".jarvis-hud");
  window.clearTimeout(Number(hud.dataset.voiceFinishTimer || 0));
  window.clearTimeout(Number(hud.dataset.voicePulseTimer || 0));
  window.clearTimeout(Number(hud.dataset.voiceFallbackTimer || 0));
  hud.dataset.voiceStartedAt = String(performance.now());
  hud.dataset.lastVoiceBoundaryAt = String(performance.now());
  hud.dataset.voiceIntensity = "0";
  hud.classList.add("speaking");
  pulseSessionFeedbackHud(hud, 0.36, 320);
  scheduleSessionFeedbackVoiceFallback(hud);
}

function pulseSessionFeedbackVoiceBoundary(modal, detail = {}) {
  const hud = modal.querySelector(".jarvis-hud");
  if (!hud?.classList.contains("speaking")) return;
  const now = performance.now();
  const lastBoundary = Number(hud.dataset.lastVoiceBoundaryAt || now - 220);
  const gap = Math.max(70, Math.min(650, now - lastBoundary));
  const speed = 1 - Math.max(0, Math.min(1, (gap - 90) / 500));
  const charIndex = Number(detail.charIndex || 0);
  const variation = ((charIndex * 37 + Math.round(now)) % 100) / 100;
  const intensity = Math.max(0.38, Math.min(1, 0.38 + speed * 0.44 + variation * 0.18));
  hud.dataset.lastVoiceBoundaryAt = String(now);
  pulseSessionFeedbackHud(hud, intensity, gap);
}

function pulseSessionFeedbackHud(hud, intensity, cadence) {
  const previousIntensity = Number(hud.dataset.voiceIntensity || 0);
  const smoothedIntensity = previousIntensity * 0.68 + intensity * 0.32;
  const transition = Math.round(Math.max(180, Math.min(380, cadence * 0.72)));
  hud.dataset.voiceIntensity = smoothedIntensity.toFixed(4);
  hud.style.setProperty("--voice-transition", `${transition}ms`);
  hud.style.setProperty("--voice-hud-scale", (1 + smoothedIntensity * 0.018).toFixed(4));
  hud.style.setProperty("--voice-core-scale", (1 + smoothedIntensity * 0.065).toFixed(4));
  hud.style.setProperty("--voice-lens-scale", (1 + smoothedIntensity * 0.115).toFixed(4));
  window.clearTimeout(Number(hud.dataset.voicePulseTimer || 0));
  hud.dataset.voicePulseTimer = String(window.setTimeout(() => {
    resetSessionFeedbackHudScale(hud, Math.max(260, transition));
  }, Math.max(210, Math.round(transition * 1.08))));
  hud.querySelectorAll(".jarvis-voice-wave").forEach((wave, index) => {
    wave.getAnimations().forEach((animation) => animation.cancel());
    wave.animate([
      { opacity: Math.max(0.14, smoothedIntensity * 0.48), transform: `scale(${0.88 + index * 0.04})` },
      { opacity: 0, transform: `scale(${1.12 + smoothedIntensity * 0.24 + index * 0.08})` },
    ], {
      duration: 720 + index * 110 + smoothedIntensity * 220,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "none",
    });
  });
}

function resetSessionFeedbackHudScale(hud, duration = 220) {
  hud.style.setProperty("--voice-transition", `${duration}ms`);
  hud.style.setProperty("--voice-hud-scale", "1");
  hud.style.setProperty("--voice-core-scale", "1");
  hud.style.setProperty("--voice-lens-scale", "1");
  hud.dataset.voiceIntensity = String(Number(hud.dataset.voiceIntensity || 0) * 0.35);
}

function scheduleSessionFeedbackVoiceFallback(hud) {
  window.clearTimeout(Number(hud.dataset.voiceFallbackTimer || 0));
  const delay = Math.round(220 + Math.random() * 240);
  hud.dataset.voiceFallbackTimer = String(window.setTimeout(() => {
    if (!hud.classList.contains("speaking")) return;
    const silence = performance.now() - Number(hud.dataset.lastVoiceBoundaryAt || 0);
    if (silence > 520) pulseSessionFeedbackHud(hud, 0.32 + Math.random() * 0.34, delay);
    scheduleSessionFeedbackVoiceFallback(hud);
  }, delay));
}

function stopSessionFeedbackVoiceAnimation(modal) {
  const hud = modal.querySelector(".jarvis-hud");
  if (!hud?.classList.contains("speaking")) return;
  window.clearTimeout(Number(hud.dataset.voiceFallbackTimer || 0));
  window.clearTimeout(Number(hud.dataset.voicePulseTimer || 0));
  window.clearTimeout(Number(hud.dataset.voiceFinishTimer || 0));
  resetSessionFeedbackHudScale(hud, 680);
  hud.dataset.voiceFinishTimer = String(window.setTimeout(() => {
    hud.classList.remove("speaking");
    delete hud.dataset.voiceStartedAt;
    delete hud.dataset.lastVoiceBoundaryAt;
    delete hud.dataset.voiceIntensity;
    delete hud.dataset.voiceFallbackTimer;
    delete hud.dataset.voicePulseTimer;
    delete hud.dataset.voiceFinishTimer;
  }, 700));
}

function jarvisHudInterface() {
  return `<div class="jarvis-hud" aria-hidden="true">
    <svg class="jarvis-hud-svg" viewBox="0 0 720 720" role="presentation">
      <defs>
        <radialGradient id="jarvisCore" cx="46%" cy="42%">
          <stop offset="0" stop-color="#29c7e3"></stop>
          <stop offset="0.28" stop-color="#0c86a7"></stop>
          <stop offset="0.62" stop-color="#05475f"></stop>
          <stop offset="1" stop-color="#01131d"></stop>
        </radialGradient>
        <linearGradient id="jarvisArc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e9ffff"></stop>
          <stop offset="0.45" stop-color="#57eeff"></stop>
          <stop offset="1" stop-color="#0d7895"></stop>
        </linearGradient>
        <filter id="jarvisGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="blur"></feGaussianBlur>
          <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
        </filter>
        <filter id="jarvisSoftGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="15"></feGaussianBlur>
        </filter>
      </defs>
      <circle class="jarvis-ambient-glow" cx="360" cy="360" r="262"></circle>
      <g class="jarvis-ring jarvis-ring-outer">
        <circle class="jarvis-line dim" cx="360" cy="360" r="326"></circle>
        <circle class="jarvis-line bright" cx="360" cy="360" r="316"></circle>
        <circle class="jarvis-dashed-ring" cx="360" cy="360" r="302"></circle>
        ${jarvisHudTicks(180, 324, 13, "jarvis-tick outer-tick")}
        ${jarvisHudTicks(60, 294, 18, "jarvis-tick major-tick", 3)}
        ${jarvisHudArcs(311, 12, 20, 9, "jarvis-arc outer-arc")}
        <circle class="jarvis-node" cx="360" cy="34" r="5"></circle>
        <circle class="jarvis-node" cx="672" cy="360" r="4"></circle>
        <circle class="jarvis-node" cx="126" cy="566" r="4"></circle>
      </g>
      <g class="jarvis-ring jarvis-ring-mid-a">
        <circle class="jarvis-band" cx="360" cy="360" r="270"></circle>
        <circle class="jarvis-line" cx="360" cy="360" r="252"></circle>
        ${jarvisHudTicks(120, 278, 20, "jarvis-tick mid-tick")}
        ${jarvisHudArcs(263, 18, 14, 12, "jarvis-arc data-arc")}
        <path class="jarvis-highlight-arc" d="${jarvisHudArcPath(276, 194, 278)}"></path>
        <path class="jarvis-warning-arc" d="${jarvisHudArcPath(242, 128, 166)}"></path>
      </g>
      <g class="jarvis-ring jarvis-ring-mid-b">
        <circle class="jarvis-line bright" cx="360" cy="360" r="224"></circle>
        <circle class="jarvis-dashed-ring dense" cx="360" cy="360" r="210"></circle>
        ${jarvisHudTicks(96, 230, 15, "jarvis-tick inner-tick")}
        ${jarvisHudArcs(215, 24, 9, 18, "jarvis-arc inner-data-arc")}
      </g>
      <g class="jarvis-ring jarvis-mech-ring-a">
        <circle class="jarvis-mech-band" cx="360" cy="360" r="190"></circle>
        ${jarvisHudArcs(184, 6, 42, 12, "jarvis-arc mech-arc-wide")}
        ${jarvisHudTicks(48, 202, 17, "jarvis-tick mech-tick", 4)}
      </g>
      <g class="jarvis-ring jarvis-mech-ring-b">
        <circle class="jarvis-mech-band secondary" cx="360" cy="360" r="132"></circle>
        ${jarvisHudArcs(138, 8, 28, 10, "jarvis-arc mech-arc-inner")}
      </g>
      <g class="jarvis-static-data">
        <path d="M96 360h74l18-13h32" class="jarvis-circuit"></path>
        <path d="M624 360h-72l-18 15h-35" class="jarvis-circuit"></path>
        <path d="M360 95v62l14 18v25" class="jarvis-circuit"></path>
        <path d="M360 625v-58l-14-18v-24" class="jarvis-circuit"></path>
        <text x="118" y="344" class="jarvis-data-text">VOICE.BUS 07</text>
        <text x="512" y="344" class="jarvis-data-text">NEURAL LINK</text>
        <text x="372" y="122" class="jarvis-data-text">SYS 84.2</text>
        <text x="372" y="607" class="jarvis-data-text">ONLINE</text>
      </g>
      <g class="jarvis-core-assembly">
        <circle class="jarvis-core-aura" cx="360" cy="360" r="178"></circle>
        <circle class="jarvis-core-frame" cx="360" cy="360" r="116"></circle>
        <circle class="jarvis-core-grid" cx="360" cy="360" r="148"></circle>
        ${jarvisHudTicks(72, 160, 12, "jarvis-tick core-tick")}
        <circle class="jarvis-core-lens" cx="360" cy="360" r="68"></circle>
        <circle class="jarvis-voice-wave wave-one" cx="360" cy="360" r="78"></circle>
        <circle class="jarvis-voice-wave wave-two" cx="360" cy="360" r="92"></circle>
        <circle class="jarvis-voice-wave wave-three" cx="360" cy="360" r="108"></circle>
      </g>
    </svg>
    <div class="jarvis-hud-noise"></div>
  </div>`;
}

function jarvisHudTicks(count, radius, length, className, emphasizedEvery = 0) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const tickLength = emphasizedEvery && index % emphasizedEvery === 0 ? length * 1.65 : length;
    const innerRadius = radius - tickLength;
    const x1 = 360 + Math.cos(angle) * innerRadius;
    const y1 = 360 + Math.sin(angle) * innerRadius;
    const x2 = 360 + Math.cos(angle) * radius;
    const y2 = 360 + Math.sin(angle) * radius;
    return `<line class="${className}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"></line>`;
  }).join("");
}

function jarvisHudArcs(radius, count, arcDegrees, gapDegrees, className) {
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => {
    const start = index * step + gapDegrees / 2;
    return `<path class="${className}" d="${jarvisHudArcPath(radius, start, start + arcDegrees)}"></path>`;
  }).join("");
}

function jarvisHudArcPath(radius, startDegrees, endDegrees) {
  const start = jarvisHudPolarPoint(radius, endDegrees);
  const end = jarvisHudPolarPoint(radius, startDegrees);
  const largeArc = endDegrees - startDegrees <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function jarvisHudPolarPoint(radius, degrees) {
  const radians = (degrees - 90) * Math.PI / 180;
  return {
    x: (360 + radius * Math.cos(radians)).toFixed(2),
    y: (360 + radius * Math.sin(radians)).toFixed(2),
  };
}

function feedbackVoiceBars() {
  const levels = [4, 8, 13, 19, 11, 26, 17, 30, 21, 12, 25, 34, 18, 29, 15, 23, 10, 17, 7, 12, 5];
  return levels.map((height, index) => `<i style="--voice-bar:${height}px;--voice-delay:${index * -0.07}s"></i>`).join("");
}

function sessionSummaryForVoice(report) {
  return voiceLanguage() === "en-US" ? report.summary_en || report.summary : report.summary;
}

function sessionFeedbackTable(report) {
  const rows = ACTION_TYPES.map(([key, label]) => {
    const items = report.actionFeedback?.[key] || [];
    const feedback = items.length ? items.join(" / ") : "감지된 동작 피드백 없음";
    const count = report.actionCounts?.[key] || 0;
    return `<article class="feedback-action-row ${count ? "detected" : ""}">
      <div><span>${label}</span><small>${count ? "동작 감지" : "감지 없음"}</small></div>
      <strong>${count}<small>회</small></strong>
      <p>${escapeHtml(feedback)}</p>
    </article>`;
  }).join("");
  return `<div class="feedback-report-wrap">${rows}</div>`;
}

function downloadFeedbackCsv(report) {
  const header = ["session_id", "created_at", "action", "count", "feedback"];
  const rows = ACTION_TYPES.map(([key, label]) => [
    report.sessionId,
    report.createdAt,
    label,
    report.actionCounts?.[key] || 0,
    (report.actionFeedback?.[key] || []).join(" / "),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadBlob(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), `${report.sessionId}_feedback.csv`);
}
