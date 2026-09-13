async function startSession() {
  if (state.activeSessionId) return;
  const member = currentTrainingMember();
  if (!member) {
    $("#feedbackText").textContent = "Select a member before starting coaching.";
    return;
  }
  let cameraConfig = activeCameraConfig();
  try {
    cameraConfig = await ensureFirstMemberCalibration(member, cameraConfig);
    cameraConfig = await ensureSessionCameraConfig(cameraConfig);
  } catch (error) {
    $("#feedbackText").textContent = error.message;
    return;
  }
  resetHud();
  startFeedbackSession(member);
  const cameraReady = await prepareSessionCamera(cameraConfig);
  if (!cameraReady) {
    clearFeedbackSession();
    return;
  }
  const created = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({
      user_id: member.user_id,
      focus: state.center.defaultFocus || "guard_and_strikes",
      camera_config: cameraConfig,
    }),
  });
  state.activeSessionId = created.session.id;
  state.activeSessionStartedAt = created.session.started_at;
  state.activeCameraConfig = created.session.camera_config || cameraConfig;
  state.sessions.unshift(created.session);
  startRecording();
  startSessionTimer();
  startRoundTimer();
  updateSessionControls();
  playTone(660);
  await startPoseTracking(created.session.id);
}

function currentTrainingMember() {
  if (state.user?.role === "MEMBER") {
    return state.profile ? { ...state.profile, username: state.user.username, email: state.user.email } : null;
  }
  return state.members.find((member) => member.id === state.selectedMemberId) || state.members[0] || state.profile || null;
}

async function ensureFirstMemberCalibration(member, cameraConfig) {
  if (cameraConfig.length >= 2) {
    const devices = await enumerateVideoDevices();
    if (devices.length < cameraConfig.length) {
      $("#feedbackText").textContent = "Only one camera found. Starting single-camera 2D mode.";
      return downgradeCameraRigToAvailableDevices();
    }
    return ensureCalibrationDeviceAssignments();
  }
  return cameraConfig;
  if (isMemberCalibrated(member)) {
    applyStoredMemberCalibration(member);
    return activeCameraConfig();
  }
  if (cameraConfig.length >= 2) {
    const devices = await enumerateVideoDevices();
    if (devices.length < cameraConfig.length) {
      cameraConfig = await downgradeCameraRigToAvailableDevices();
      $("#feedbackText").textContent = "Only one camera found. Starting in 2D calibration mode.";
    } else {
      cameraConfig = await ensureCalibrationDeviceAssignments();
    }
  }
  $("#cameraStatus").textContent = "Member calibration required";
  $("#feedbackText").textContent = "First session for this member: starting height-based calibration.";
  const progress = (message) => {
    $("#cameraStatus").textContent = "회원 보정 중";
    $("#feedbackText").textContent = message;
  };
  const calibration = await performHumanCalibration(cameraConfig, member, progress);
  const reach = calibration.body_scale?.estimated_reach_cm;
  $("#feedbackText").textContent = reach
    ? `보정이 완료되었습니다. 리치 ${reach}cm를 저장했습니다.`
    : "보정이 완료되었습니다.";
  return activeCameraConfig();
}

async function ensureSessionCameraConfig(cameraConfig) {
  if (cameraConfig.length < 2) return cameraConfig;
  const devices = await enumerateVideoDevices();
  if (devices.length < cameraConfig.length) {
    $("#feedbackText").textContent = "Not enough cameras found. Falling back to single-camera 2D mode.";
    return downgradeCameraRigToAvailableDevices();
  }
  const assigned = cameraConfig.slice(1).map((camera) => camera.device_id).filter(Boolean);
  if (assigned.length < Math.max(0, cameraConfig.length - 1) || new Set(assigned).size < assigned.length) {
    return ensureCalibrationDeviceAssignments();
  }
  return cameraConfig;
}

async function prepareSessionCamera(cameraConfig = activeCameraConfig()) {
  const sources = await startSessionCameras(cameraConfig);
  if (!sources.length) return false;
  try {
    if (sources.length >= 2) {
      await loadPoseLandmarkers(sources.length);
    } else {
      await loadPoseLandmarker();
    }
    $("#cameraStatus").textContent = sources.length >= 2
      ? `MediaPipe 2.5D depth assist ready (${sources.length} cams)`
      : "MediaPipe camera ready";
    return true;
  } catch (error) {
    stopCamera();
    $("#feedbackText").textContent = `MediaPipe 모델을 불러오지 못했습니다. 인터넷 연결을 확인해주세요. ${error.message}`;
    return false;
  }
}

async function stopSession() {
  if (!state.activeSessionId) return;
  const sessionId = state.activeSessionId;
  const score = Number($("#scoreValue").textContent) || 0;
  flushFeedbackWindow(true);
  const feedbackReport = buildSessionFeedbackReport(sessionId, score);
  state.activeSessionId = "";
  state.activeCameraConfig = [];
  stopSessionTimer();
  stopRoundTimer();
  const recording = await stopRecording(sessionId);
  stopPoseTracking();
  stopCamera();
  const result = await api(`/sessions/${sessionId}/end`, {
    method: "PATCH",
    body: JSON.stringify({ overall_score: score, feedback_report: JSON.stringify(feedbackReport) }),
  });
  state.sessions = state.sessions.map((session) => (session.id === sessionId ? result.session : session));
  if (recording) {
    state.localRecordings[sessionId] = recording;
  }
  playTone(420);
  notifyUser("운동 세션 종료", `점수 ${score}점으로 세션이 저장되었습니다.`);
  showSessionFeedbackModal(feedbackReport);
  clearFeedbackSession();
  updateSessionControls();
  resetHud();
}

async function loadPoseLandmarker() {
  if (state.poseLandmarker) return state.poseLandmarker;
  const { PoseLandmarker, vision } = await loadPoseRuntime();
  try {
    state.poseLandmarker = await createPoseLandmarker(PoseLandmarker, vision, "GPU");
  } catch (error) {
    console.warn("MediaPipe GPU delegate failed, retrying with CPU.", error);
    state.poseLandmarker = await createPoseLandmarker(PoseLandmarker, vision, "CPU");
  }
  return state.poseLandmarker;
}

async function createCalibrationPoseLandmarker() {
  const { PoseLandmarker, vision } = await loadPoseRuntime();
  try {
    return await createPoseLandmarker(PoseLandmarker, vision, "GPU", "IMAGE");
  } catch (error) {
    console.warn("MediaPipe GPU delegate failed for calibration, retrying with CPU.", error);
    return createPoseLandmarker(PoseLandmarker, vision, "CPU", "IMAGE");
  }
}

async function loadPoseRuntime() {
  if (state.poseRuntime) return state.poseRuntime;
  const { FilesetResolver, PoseLandmarker } = await import(`${MEDIAPIPE_TASKS_BASE}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_TASKS_BASE}/wasm`);
  state.poseRuntime = { PoseLandmarker, vision };
  return state.poseRuntime;
}

async function loadPoseLandmarkers(count) {
  const { PoseLandmarker, vision } = await loadPoseRuntime();
  while (state.poseLandmarkers.length < count) {
    try {
      state.poseLandmarkers.push(await createPoseLandmarker(PoseLandmarker, vision, "GPU"));
    } catch (error) {
      console.warn("MediaPipe GPU delegate failed for a camera, retrying with CPU.", error);
      state.poseLandmarkers.push(await createPoseLandmarker(PoseLandmarker, vision, "CPU"));
    }
  }
  return state.poseLandmarkers.slice(0, count);
}

function createPoseLandmarker(PoseLandmarker, vision, delegate, runningMode = "VIDEO") {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MEDIAPIPE_POSE_MODEL,
      delegate,
    },
    runningMode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  });
}

async function startPoseTracking(sessionId) {
  state.poseRunning = true;
  state.lastVideoTime = -1;
  state.poseTimestampOriginMs = monotonicNowMs();
  state.poseTimestampMs = 0;
  state.poseErrorShown = false;
  $("#cameraStatus").textContent = state.sessionCameraSources.length >= 2
    ? "MediaPipe 2.5D depth assist tracking"
    : "MediaPipe motion tracking";
  const video = $("#cameraPreview");
  const tick = () => {
    if (!state.poseRunning || state.activeSessionId !== sessionId) return;
    if (state.sessionCameraSources.length >= 2) {
      updatePoseFromCameraSources(sessionId);
    } else {
      updatePoseFromVideo(video, sessionId);
    }
    state.poseLoop = requestAnimationFrame(tick);
  };
  tick();
}

function stopPoseTracking() {
  state.poseRunning = false;
  if (state.poseLoop) cancelAnimationFrame(state.poseLoop);
  state.poseLoop = null;
  state.lastVideoTime = -1;
  state.poseTimestampMs = 0;
  state.poseTimestampOriginMs = 0;
  if (state.poseLandmarker || state.poseLandmarkers.length) resetPoseLandmarker();
}

function updatePoseFromCameraSources(sessionId) {
  if (!state.poseLandmarkers.length && !state.poseLandmarker) return;
  try {
    const updatedObservations = [];
    for (const [index, source] of state.sessionCameraSources.entries()) {
      if (!source.video || source.video.readyState < 2 || source.video.currentTime === source.lastVideoTime) continue;
      source.lastVideoTime = source.video.currentTime;
      const landmarker = state.poseLandmarkers[index] || state.poseLandmarker;
      const result = landmarker.detectForVideo(source.video, nextPoseTimestampMs());
      const landmarks = result.landmarks && result.landmarks[0];
      const keypoints = keypointsFromLandmarks(landmarks || []);
      source.latestObservation = {
        camera_id: source.camera.camera_id,
        view_angle: source.camera.view_angle,
        timestamp: Date.now() / 1000,
        keypoints,
      };
      updatedObservations.push(source.latestObservation);
    }
    const primarySource = state.sessionCameraSources[0];
    const primaryObservation = primarySource?.latestObservation;
    if (!primaryObservation && !updatedObservations.length) return;
    const observations = synchronizedCameraObservations();
    const fallbackPacket = primaryObservation
      ? packetWithDepthAssist(sessionId, primaryObservation, primarySource.camera, observations)
      : null;
    if (fallbackPacket) {
      state.latestPose = fallbackPacket;
      updateHud(fallbackPacket);
      drawSkeleton();
    }
    requestPose3dUpdate(sessionId, observations, fallbackPacket);
  } catch (error) {
    handlePoseTrackingError(error);
  }
}

function updatePoseFromVideo(video, sessionId) {
  if (!state.poseLandmarker || video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  try {
    const result = state.poseLandmarker.detectForVideo(video, nextPoseTimestampMs());
    const landmarks = result.landmarks && result.landmarks[0];
    const packet = packetFromLandmarks(sessionId, landmarks || []);
    state.latestPose = packet;
    updateHud(packet);
    drawSkeleton();
  } catch (error) {
    handlePoseTrackingError(error);
  }
}

function synchronizedCameraObservations(maxAgeSeconds = 0.45) {
  const now = Date.now() / 1000;
  return state.sessionCameraSources
    .map((source) => source.latestObservation)
    .filter((observation) => observation && now - observation.timestamp <= maxAgeSeconds);
}

function requestPose3dUpdate(sessionId, observations, fallbackPacket) {
  const rig = cameraRigSummary(state.activeCameraConfig.length ? state.activeCameraConfig : activeCameraConfig());
  if (rig.mode !== "3D" || !rig.ready || observations.length < 2) return;
  const now = Date.now();
  if (state.pose3dInFlight || now - state.lastPose3dAt < 120) return;
  state.pose3dInFlight = true;
  state.lastPose3dAt = now;
  api("/pose/3d", {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      camera_config: state.activeCameraConfig.length ? state.activeCameraConfig : activeCameraConfig(),
      observations,
    }),
  })
    .then((result) => {
      const pose = result.pose || {};
      state.pose3dStatus = pose.status || "";
      if (pose.status !== "tracking" || !(pose.keypoints_3d || []).length) return;
      const packet = packetFrom3dPose(sessionId, pose, fallbackPacket);
      state.latestPose = packet;
      state.lastPose3dPacketAt = Date.now();
      updateHud(packet);
      drawSkeleton();
    })
    .catch((error) => {
      state.pose3dStatus = error.message || "3d_pose_failed";
    })
    .finally(() => {
      state.pose3dInFlight = false;
    });
}

function handlePoseTrackingError(error) {
  if (state.poseErrorShown) return;
  state.poseErrorShown = true;
  $("#cameraStatus").textContent = "Pose inference error";
  $("#feedbackText").textContent = `Motion tracking paused. Stop this session and start again. ${error.message}`;
  console.error(error);
}

function nextPoseTimestampMs() {
  if (!state.poseTimestampOriginMs) state.poseTimestampOriginMs = monotonicNowMs();
  const elapsedMs = Math.max(0, Math.floor(monotonicNowMs() - state.poseTimestampOriginMs));
  state.poseTimestampMs = Math.max(elapsedMs, state.poseTimestampMs + 1);
  return state.poseTimestampMs;
}

function monotonicNowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function resetPoseLandmarker() {
  const landmarkers = new Set([state.poseLandmarker, ...state.poseLandmarkers].filter(Boolean));
  landmarkers.forEach((landmarker) => {
    try {
      landmarker?.close?.();
    } catch (error) {
      console.warn("MediaPipe close failed.", error);
    }
  });
  state.poseLandmarker = null;
  state.poseLandmarkers = [];
}

async function startSessionCameras(cameraConfig = activeCameraConfig()) {
  stopCamera();
  const config = cameraConfig.length ? cameraConfig : [primaryCameraConfig()];
  const sources = [];
  try {
    for (const camera of config) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraVideoConstraints(camera),
        audio: false,
      });
      const video = sources.length === 0 ? $("#cameraPreview") : document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      await waitForVideoReady(video);
      sources.push({
        camera,
        stream,
        video,
        lastVideoTime: -1,
        latestObservation: null,
      });
    }
    const preview = $("#cameraPreview");
    preview.classList.remove("hidden");
    $("#cameraFallback").classList.add("hidden");
    $("#cameraOffline").classList.add("hidden");
    state.sessionCameraSources = sources;
    state.cameraReady = sources.length > 0;
    state.recordingStream = sources[0]?.stream || null;
    renderCameraMiniOverlay(sources);
    return sources;
  } catch (error) {
    stopSessionCameraSources(sources);
    clearCameraMiniOverlay();
    state.cameraReady = false;
    $("#cameraFallback").classList.remove("hidden");
    $("#cameraOffline").classList.remove("hidden");
    $("#feedbackText").textContent = `Camera start failed: ${error.message || error}`;
    return [];
  }
}

async function startCamera(camera = primaryCameraConfig()) {
  clearCameraMiniOverlay();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: cameraVideoConstraints(camera),
      audio: false,
    });
    const video = $("#cameraPreview");
    video.srcObject = stream;
    video.classList.remove("hidden");
    $("#cameraFallback").classList.add("hidden");
    $("#cameraOffline").classList.add("hidden");
    await waitForVideoReady(video);
    state.cameraReady = true;
    state.recordingStream = stream;
    return stream;
  } catch {
    state.cameraReady = false;
    $("#cameraFallback").classList.remove("hidden");
    $("#cameraOffline").classList.remove("hidden");
    resetHud();
    return null;
  }
}

function stopSessionCameraSources(sources = state.sessionCameraSources) {
  const stopped = new Set();
  sources.forEach((source) => {
    if (source.stream && !stopped.has(source.stream)) {
      source.stream.getTracks().forEach((track) => track.stop());
      stopped.add(source.stream);
    }
    if (source.video) source.video.srcObject = null;
  });
  return stopped;
}

function clearCameraMiniOverlay() {
  const overlay = $("#cameraMiniOverlay");
  if (!overlay) return;
  overlay.innerHTML = "";
  overlay.classList.add("hidden");
  overlay.removeAttribute("data-count");
}

function renderCameraMiniOverlay(sources = state.sessionCameraSources) {
  const overlay = $("#cameraMiniOverlay");
  if (!overlay) return;
  overlay.innerHTML = "";
  const miniSources = sources.slice(1).filter((source) => source.video);
  if (!miniSources.length) {
    clearCameraMiniOverlay();
    return;
  }
  overlay.dataset.count = String(miniSources.length);
  miniSources.forEach((source, index) => {
    const card = document.createElement("div");
    card.className = "camera-mini-card";

    const video = source.video;
    video.classList.add("camera-mini-video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement("span");
    const cameraLabel = source.camera?.label || source.camera?.view_angle || `CAM ${index + 2}`;
    label.textContent = `${index + 2} · ${cameraLabel}`;

    card.append(video, label);
    overlay.appendChild(card);
    video.play().catch(() => {});
  });
  overlay.classList.remove("hidden");
}

function waitForVideoReady(video) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.play().then(resolve).catch(reject);
    };
    if (video.readyState >= 2 && video.videoWidth > 0) {
      done();
      return;
    }
    video.addEventListener("loadedmetadata", done, { once: true });
    video.addEventListener("error", () => reject(new Error("camera preview could not start")), { once: true });
  });
}

function stopCamera() {
  const stopped = stopSessionCameraSources();
  clearCameraMiniOverlay();
  const stream = $("#cameraPreview").srcObject;
  if (stream && !stopped.has(stream)) {
    stream.getTracks().forEach((track) => track.stop());
  }
  $("#cameraPreview").srcObject = null;
  $("#cameraPreview").classList.remove("hidden");
  $("#cameraFallback").classList.remove("hidden");
  state.cameraReady = false;
  state.recordingStream = null;
  state.sessionCameraSources = [];
  state.pose3dInFlight = false;
  state.lastPose3dAt = 0;
  state.lastPose3dPacketAt = 0;
}

function startRecording() {
  state.recordedChunks = [];
  if (!window.MediaRecorder) {
    $("#feedbackText").textContent = "이 브라우저는 운동 녹화를 지원하지 않습니다. 세션 기록만 저장됩니다.";
    return;
  }
  const stream = startHudCapture();
  if (!stream) {
    $("#feedbackText").textContent = "이 브라우저는 코칭 화면 녹화를 지원하지 않습니다. 세션 기록만 저장됩니다.";
    return;
  }
  const options = preferredRecordingOptions();
  state.recorder = new MediaRecorder(stream, options);
  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordedChunks.push(event.data);
  });
  state.recorder.start(1000);
}

function preferredRecordingOptions() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : {};
}

function startHudCapture() {
  stopHudCapture();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  if (!canvas.captureStream) return null;
  state.recordingCanvas = canvas;
  const stream = canvas.captureStream(30);
  const drawFrame = () => {
    drawRecordingFrame(canvas);
    state.recordingFrame = requestAnimationFrame(drawFrame);
  };
  drawFrame();
  return stream;
}

function stopHudCapture() {
  if (state.recordingFrame) cancelAnimationFrame(state.recordingFrame);
  state.recordingFrame = null;
  state.recordingCanvas = null;
}

function drawRecordingFrame(canvas) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#03141f");
  gradient.addColorStop(1, "#06101a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  drawRecordingCamera(ctx, 0, 0, width, height, true);
  drawRecordingGrid(ctx, width, height);
  drawRecordingSkeleton(ctx, width, height);
  drawRecordingOverlay(ctx, width, height);
}

function drawRecordingGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(99, 234, 255, 0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoverImage(ctx, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.naturalWidth || width;
  const sourceHeight = source.videoHeight || source.naturalHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  ctx.drawImage(source, x + (width - scaledWidth) / 2, y + (height - scaledHeight) / 2, scaledWidth, scaledHeight);
}

function poseRenderRect(width, height) {
  const video = $("#cameraPreview");
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    x: (width - renderedWidth) / 2,
    y: (height - renderedHeight) / 2,
    width: renderedWidth,
    height: renderedHeight,
  };
}

function posePointToCanvas(point, width, height) {
  const rect = poseRenderRect(width, height);
  return {
    x: rect.x + (1 - point.x) * rect.width,
    y: rect.y + point.y * rect.height,
  };
}

function posePointsForCanvas(packet, width, height) {
  return Object.fromEntries(packet.keypoints.map((point) => [
    point.name,
    posePointToCanvas(point, width, height),
  ]));
}

function drawRecordingSkeleton(ctx, width, height) {
  if (!state.latestPose) return;
  const points = posePointsForCanvas(state.latestPose, width, height);
  const bones = [
    ["nose", "left_shoulder"], ["nose", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
  ];
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(46, 232, 255, 0.92)";
  ctx.shadowColor = "rgba(46, 232, 255, 0.85)";
  ctx.shadowBlur = 18;
  bones.forEach(([from, to]) => {
    if (!points[from] || !points[to]) return;
    ctx.beginPath();
    ctx.moveTo(points[from].x, points[from].y);
    ctx.lineTo(points[to].x, points[to].y);
    ctx.stroke();
  });
  Object.values(points).forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = "#e8fbff";
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawRecordingOverlay(ctx, width, height) {
  const score = $("#scoreValue").textContent || "--";
  const confidence = $("#confidenceValue").textContent || "confidence --";
  const action = $("#targetAction").textContent || "카메라 연결 대기";
  const feedback = $("#feedbackText").textContent || "";
  const status = $("#cameraStatus").textContent || "";
  drawRecordingCard(ctx, 42, 42, 330, 128, "수행 동작", action, status);
  drawRecordingCard(ctx, width - 232, 42, 190, 154, "점수", score, confidence, true);
  drawRecordingFeedbackCard(ctx, 42, height - 200, 580, 158, feedback);
}

function drawRecordingCard(ctx, x, y, width, height, label, value, note, isScore = false) {
  ctx.save();
  ctx.fillStyle = "rgba(3, 18, 28, 0.72)";
  ctx.strokeStyle = "rgba(99, 234, 255, 0.36)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(198, 243, 255, 0.78)";
  ctx.font = "18px Arial";
  ctx.fillText(label, x + 20, y + 30);
  ctx.fillStyle = isScore ? "#2ee8ff" : "#f2fdff";
  ctx.font = isScore ? "72px Arial" : "28px Arial";
  wrapCanvasText(ctx, value, x + 20, y + (isScore ? 100 : 68), width - 40, isScore ? 72 : 32);
  if (note) {
    ctx.fillStyle = "rgba(198, 243, 255, 0.78)";
    ctx.font = "17px Arial";
    wrapCanvasText(ctx, note, x + 20, y + height - 34, width - 40, 22);
  }
  ctx.restore();
}

function drawRecordingFeedbackCard(ctx, x, y, width, height, fallbackText) {
  const items = state.feedbackLog.length
    ? state.feedbackLog
    : [{ label: "AI", text: fallbackText, time: "" }];
  ctx.save();
  ctx.fillStyle = "rgba(3, 18, 28, 0.72)";
  ctx.strokeStyle = "rgba(99, 234, 255, 0.36)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(198, 243, 255, 0.78)";
  ctx.font = "18px Arial";
  ctx.fillText("AI 피드백", x + 20, y + 30);
  items.slice(0, 2).forEach((item, index) => {
    const rowY = y + 64 + index * 42;
    ctx.strokeStyle = "rgba(99, 234, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(x + 20, rowY - 16);
    ctx.lineTo(x + width - 20, rowY - 16);
    ctx.stroke();
    ctx.fillStyle = "#d8f6fc";
    ctx.font = "15px Arial";
    wrapCanvasText(ctx, item.text, x + 20, rowY, width - 40, 18);
  });
  ctx.restore();
}

function drawRecordingCamera(ctx, x, y, width, height, fullBleed = false) {
  const video = $("#cameraPreview");
  ctx.save();
  if (!fullBleed) {
    roundRect(ctx, x, y, width, height, 8);
    ctx.fillStyle = "rgba(3, 18, 28, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(99, 234, 255, 0.36)";
    ctx.stroke();
    ctx.clip();
  }
  if (video.readyState >= 2) {
    ctx.translate(x + width, y);
    ctx.scale(-1, 1);
    drawCoverImage(ctx, video, 0, 0, width, height);
  } else {
    ctx.fillStyle = "rgba(46, 232, 255, 0.10)";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "rgba(198, 243, 255, 0.78)";
    ctx.font = "18px Arial";
    if (!fullBleed) ctx.fillText("LIVE CAMERA", x + 84, y + height / 2);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(" ");
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

function stopRecording(sessionId) {
  return new Promise((resolve) => {
    if (!state.recorder || state.recorder.state === "inactive") {
      stopHudCapture();
      resolve(null);
      return;
    }
    state.recorder.addEventListener("stop", async () => {
      const blob = new Blob(state.recordedChunks, { type: state.recorder.mimeType || "video/webm" });
      const recording = {
        id: sessionId,
        mimeType: blob.type,
        size: blob.size,
        savedAt: Date.now(),
        blob,
      };
      if (blob.size > 0) {
        try {
          await saveRecording(recording);
        } catch (error) {
          console.warn(error);
        }
        resolve(recording);
      } else {
        resolve(null);
      }
      state.recorder = null;
      state.recordedChunks = [];
      stopHudCapture();
    }, { once: true });
    state.recorder.stop();
  });
}

function openRecordingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("boxing_coach_recordings", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecording(recording) {
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("recordings", "readwrite").objectStore("recordings").put(recording);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function loadLocalRecordings() {
  if (!window.indexedDB) return {};
  try {
    const db = await openRecordingDb();
    const recordings = await new Promise((resolve, reject) => {
      const request = db.transaction("recordings", "readonly").objectStore("recordings").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return Object.fromEntries(recordings.map((recording) => [recording.id, recording]));
  } catch (error) {
    console.warn(error);
    return {};
  }
}

async function deleteRecording(sessionId) {
  if (!window.indexedDB) return;
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("recordings", "readwrite").objectStore("recordings").delete(sessionId);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

function playRecording(sessionId) {
  const recording = state.localRecordings[sessionId];
  if (!recording) return;
  const url = URL.createObjectURL(recording.blob);
  const viewer = window.open("", "_blank", "width=900,height=640");
  if (!viewer) return;
  viewer.document.write(`<title>운동 녹화</title><video src="${url}" controls autoplay style="width:100%;height:100%;background:#000"></video>`);
  viewer.addEventListener("beforeunload", () => URL.revokeObjectURL(url));
}

async function downloadRecording(sessionId) {
  const recording = state.localRecordings[sessionId];
  if (!recording) return;
  if (recording.mimeType.includes("mp4")) {
    downloadBlob(recording.blob, `${sessionId}.mp4`);
    return;
  }
  try {
    const mp4 = await convertRecordingToMp4(recording.blob);
    downloadBlob(mp4, `${sessionId}.mp4`);
  } catch (error) {
    alert(`${error.message}\n\nMP4 변환을 할 수 없어 원본 WebM 파일로 저장합니다.`);
    downloadBlob(recording.blob, `${sessionId}.${recordingExtension(recording.mimeType)}`);
  }
}

function recordingExtension(mimeType = "") {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "video";
}

async function convertRecordingToMp4(blob) {
  const headers = { "Content-Type": blob.type || "video/webm" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await platformApiFetch("/recordings/convert", {
    method: "POST",
    headers,
    body: blob,
  });
  if (!response.ok) {
    let message = "MP4 변환에 실패했습니다.";
    try {
      const payload = await response.json();
      message = payload.error || payload.detail || message;
    } catch {
    }
    throw new Error(message);
  }
  return response.blob();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteSelectedMemberRecords() {
  const selectedIds = [...state.selectedRecordIds];
  if (!selectedIds.length) return;
  if (!confirm(`선택한 운동기록 ${selectedIds.length}개를 삭제할까요?`)) return;
  for (const sessionId of selectedIds) {
    await api(`/sessions/${sessionId}`, { method: "DELETE" });
    await deleteRecording(sessionId);
    delete state.localRecordings[sessionId];
  }
  state.sessions = state.sessions.filter((session) => !state.selectedRecordIds.has(session.id));
  state.selectedRecordIds.clear();
  renderMembers();
}

function startSessionTimer() {
  stopSessionTimer();
  updateSessionControls();
  state.sessionTimer = setInterval(updateSessionControls, 1000);
}

function stopSessionTimer() {
  if (state.sessionTimer) clearInterval(state.sessionTimer);
  state.sessionTimer = null;
}

function startRoundTimer() {
  stopRoundTimer();
  const durationSeconds = sessionDurationSecondsFromCenter();
  state.roundTimer = setTimeout(() => {
    if (state.activeSessionId) stopSession();
  }, durationSeconds * 1000);
}

function stopRoundTimer() {
  if (state.roundTimer) clearTimeout(state.roundTimer);
  state.roundTimer = null;
}

function updateSessionControls() {
  const isActive = Boolean(state.activeSessionId);
  $("#sessionState").textContent = isActive ? "녹화 중" : "대기 중";
  $("#sessionTimer").textContent = isActive ? sessionTimerText() : "00:00";
  $("#startSessionHud").disabled = isActive;
  $("#stopSessionHud").disabled = !isActive;
  $("#startSession").disabled = isActive;
}

function sessionTimerText() {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000 - state.activeSessionStartedAt));
  const durationSeconds = sessionDurationSecondsFromCenter();
  return `${formatSeconds(elapsedSeconds)} / ${formatSeconds(durationSeconds)}`;
}

function formatSeconds(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const poseIndexes = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
};

function packetFromLandmarks(sessionId, landmarks) {
  const camera = state.activeCameraConfig[0] || primaryCameraConfig();
  return packetFromKeypoints(sessionId, keypointsFromLandmarks(landmarks), camera);
}

function packetWithDepthAssist(sessionId, primaryObservation, camera = primaryCameraConfig(), observations = []) {
  const assist = depthAssistFromObservations(primaryObservation, observations);
  const multiCameraExtra = { multi_camera_observations: compactCameraObservations(observations) };
  if (!assist) {
    return packetFromKeypoints(sessionId, primaryObservation.keypoints || [], camera, {
      extra: multiCameraExtra,
    });
  }
  const keypoints = applyDepthAssistToKeypoints(primaryObservation.keypoints || [], assist);
  return packetFromKeypoints(sessionId, keypoints, camera, {
    pose_mode: "2.5D",
    pose_space: "screen_2d_depth_assist",
    extra: { ...multiCameraExtra, depth_assist: assist },
  });
}

function compactCameraObservations(observations = []) {
  return observations.map((observation) => ({
    camera_id: observation.camera_id,
    view_angle: observation.view_angle,
    timestamp: observation.timestamp,
    keypoints: observation.keypoints || [],
  }));
}

function packetFromKeypoints(sessionId, keypoints, camera = primaryCameraConfig(), overrides = {}) {
  const rig = cameraRigSummary(state.activeCameraConfig.length ? state.activeCameraConfig : activeCameraConfig());
  const confidence = averageKeypointScore(keypoints);
  const status = confidence >= 0.45 ? "tracking" : "no_person";
  const metrics = boxingMetrics(keypoints);
  const feedbackData = boxingFeedback(metrics, status);
  const poseMode = overrides.pose_mode || rig.mode;
  const poseSpace = overrides.pose_space || (poseMode === "3D" ? "camera_2d_source" : "screen_2d");
  return {
    session_id: sessionId,
    camera_id: overrides.camera_id || camera.camera_id || "browser_camera",
    view_angle: overrides.view_angle || camera.view_angle || "front",
    pose_mode: poseMode,
    pose_space: poseSpace,
    timestamp: overrides.timestamp || Date.now() / 1000,
    pose_sequence_id: `${sessionId}:${Math.floor(Date.now() / 1000)}`,
    keypoints,
    confidence: Number(confidence.toFixed(3)),
    action: currentInstructionText(feedbackData.action),
    score: sessionAverageInstructionScore(),
    feedback: feedbackData.feedback,
    feedback_log: feedbackData.logs,
    status,
    metrics,
    ...(overrides.extra || {}),
  };
}

function packetFrom3dPose(sessionId, pose, fallbackPacket = null) {
  const camera = state.activeCameraConfig[0] || primaryCameraConfig();
  const keypoints3d = pose.keypoints_3d || [];
  const keypoints = project3dKeypointsForDisplay(keypoints3d, fallbackPacket?.keypoints || [], camera);
  return packetFromKeypoints(sessionId, keypoints, camera, {
    camera_id: "multi_camera_rig",
    view_angle: "world_3d",
    pose_mode: "3D",
    pose_space: "world_3d",
    timestamp: pose.timestamp || Date.now() / 1000,
    extra: {
      keypoints_3d: keypoints3d,
      pose3d_status: pose.status,
      calibration: pose.calibration,
    },
  });
}

function keypointsFromLandmarks(landmarks) {
  return Object.entries(poseIndexes).map(([name, index]) => {
    const point = landmarks[index];
    const score = point ? Math.min(point.visibility ?? point.presence ?? 1, 1) : 0;
    return {
      name,
      x: clamp(point?.x || 0),
      y: clamp(point?.y || 0),
      z: Number((point?.z || 0).toFixed(5)),
      score: Number(score.toFixed(3)),
    };
  });
}

function depthAssistFromObservations(primaryObservation, observations) {
  const primaryCameraId = primaryObservation?.camera_id || "";
  const primaryPoints = pointsByName(primaryObservation?.keypoints || []);
  const assistObservation = observations.find((observation) =>
    observation?.camera_id !== primaryCameraId
    && averageKeypointScore(observation.keypoints || []) >= 0.35
  );
  if (!assistObservation) return null;
  const assistPoints = pointsByName(assistObservation.keypoints || []);
  const left = depthAssistSideScore("left", primaryPoints, assistPoints, assistObservation.view_angle);
  const right = depthAssistSideScore("right", primaryPoints, assistPoints, assistObservation.view_angle);
  const activeSide = chooseDepthAssistSide(left, right);
  return {
    mode: "2.5D",
    source_camera_id: assistObservation.camera_id,
    view_angle: assistObservation.view_angle,
    active_side: activeSide,
    left,
    right,
  };
}

function applyDepthAssistToKeypoints(keypoints, assist) {
  return keypoints.map((point) => {
    if (point.name !== "left_wrist" && point.name !== "right_wrist") return point;
    const side = point.name.startsWith("left") ? "left" : "right";
    const sideAssist = assist[side] || {};
    const active = assist.active_side === side;
    return {
      ...point,
      depth_forward: active ? sideAssist.forward : 0,
      depth_candidate: sideAssist.forward || 0,
      depth_score: sideAssist.score || 0,
      depth_active: active,
    };
  });
}

function depthAssistSideScore(side, primaryPoints, assistPoints, viewAngle = "") {
  const shoulder = primaryPoints[`${side}_shoulder`] || {};
  const elbow = primaryPoints[`${side}_elbow`] || {};
  const wrist = primaryPoints[`${side}_wrist`] || {};
  const primaryReliability = averageVisibility([shoulder, elbow, wrist]);
  const primaryScale = Math.max(Math.abs((primaryPoints.right_shoulder?.x || 0) - (primaryPoints.left_shoulder?.x || 0)), 0.1);
  const primaryExtension = punchExtension(wrist, shoulder, primaryScale);
  const primaryStraightness = elbowStraightnessScore(shoulder, elbow, wrist);
  const primaryCue = clampScore(primaryExtension * 0.55 + primaryStraightness * 0.45);

  const assistShoulder = assistPoints[`${side}_shoulder`] || {};
  const assistElbow = assistPoints[`${side}_elbow`] || {};
  const assistWrist = assistPoints[`${side}_wrist`] || {};
  const assistReliability = averageVisibility([assistShoulder, assistElbow, assistWrist]);
  const depthScale = sideDepthScale(assistPoints);
  const depthAxis = depthAxisForView(viewAngle);
  const forward = clampScore((Math.abs(Number(assistWrist[depthAxis] || 0) - Number(assistShoulder[depthAxis] || 0)) / depthScale) * 85);
  const assistStraightness = elbowStraightnessScore(assistShoulder, assistElbow, assistWrist);
  const assistCue = clampScore(forward * 0.72 + assistStraightness * 0.28);
  const reliability = Math.min(primaryReliability, assistReliability);
  return {
    forward,
    score: clampScore(primaryCue * 0.52 + assistCue * 0.40 + reliability * 8),
    primary_extension: primaryExtension,
    primary_straightness: primaryStraightness,
    assist_straightness: assistStraightness,
    reliability: Number(reliability.toFixed(3)),
  };
}

function chooseDepthAssistSide(left, right) {
  const candidates = [
    ["left", left],
    ["right", right],
  ].filter(([, score]) => score.reliability >= 0.35 && score.score >= 45);
  if (!candidates.length) return "";
  candidates.sort((a, b) => b[1].score - a[1].score);
  const [bestSide, best] = candidates[0];
  const second = candidates[1]?.[1];
  if (!second || best.score - second.score >= 8 || best.forward - second.forward >= 12) return bestSide;
  return "";
}

function pointsByName(points) {
  return Object.fromEntries((points || []).map((point) => [point.name, point]));
}

function sideDepthScale(points) {
  const leftShoulder = points.left_shoulder || {};
  const rightShoulder = points.right_shoulder || {};
  const leftHip = points.left_hip || {};
  const rightHip = points.right_hip || {};
  const shoulderSpan = distance2d(leftShoulder, rightShoulder);
  const shoulderY = (Number(leftShoulder.y || 0) + Number(rightShoulder.y || 0)) / 2;
  const hipY = (Number(leftHip.y || 0) + Number(rightHip.y || 0)) / 2;
  const torsoHeight = Math.abs(hipY - shoulderY);
  return Math.max(shoulderSpan, torsoHeight * 0.65, 0.12);
}

function depthAxisForView(viewAngle = "") {
  return viewAngle.includes("side") || viewAngle.includes("rear") ? "x" : "x";
}

function elbowStraightnessScore(shoulder, elbow, wrist) {
  if (averageVisibility([shoulder, elbow, wrist]) <= 0.25) return 0;
  const angle = angleDegrees(shoulder, elbow, wrist);
  return clampScore(((angle - 95) / 75) * 100);
}

function angleDegrees(first, middle, last) {
  const ax = Number(first.x || 0) - Number(middle.x || 0);
  const ay = Number(first.y || 0) - Number(middle.y || 0);
  const bx = Number(last.x || 0) - Number(middle.x || 0);
  const by = Number(last.y || 0) - Number(middle.y || 0);
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (!aLength || !bLength) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aLength * bLength)));
  return Math.acos(cosine) * 180 / Math.PI;
}

function distance2d(first, second) {
  return Math.hypot(Number(first.x || 0) - Number(second.x || 0), Number(first.y || 0) - Number(second.y || 0));
}

function project3dKeypointsForDisplay(keypoints3d, fallbackKeypoints = [], camera = primaryCameraConfig()) {
  const fallbackByName = Object.fromEntries(fallbackKeypoints.map((point) => [point.name, point]));
  const matrix = camera.projection_matrix || camera.projectionMatrix || camera.calibration?.projection_matrix || null;
  const projected = matrix ? keypoints3d.map((point) => projectPointWithMatrix(point, matrix)) : [];
  const usableProjected = projected.filter((point) => point && point.x >= -0.5 && point.x <= 1.5 && point.y >= -0.5 && point.y <= 1.5);
  const displayByName = usableProjected.length >= 6
    ? Object.fromEntries(usableProjected.map((point) => [point.name, point]))
    : normalizedWorldKeypoints(keypoints3d);
  return keypoints3d.map((point) => {
    const display = displayByName[point.name] || fallbackByName[point.name] || {};
    return {
      name: point.name,
      x: clamp(display.x ?? fallbackByName[point.name]?.x ?? 0.5),
      y: clamp(display.y ?? fallbackByName[point.name]?.y ?? 0.5),
      z: Number(point.z || 0),
      score: Number(Math.min(point.score || fallbackByName[point.name]?.score || 0, 1).toFixed(3)),
      world_x: Number(point.x || 0),
      world_y: Number(point.y || 0),
      world_z: Number(point.z || 0),
    };
  });
}

function projectPointWithMatrix(point, matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  if (rows.length < 3 || rows.some((row) => !Array.isArray(row) || row.length < 4)) return null;
  const x = Number(point.x || 0);
  const y = Number(point.y || 0);
  const z = Number(point.z || 0);
  const denominator = rows[2][0] * x + rows[2][1] * y + rows[2][2] * z + rows[2][3];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 0.000001) return null;
  const projectedX = (rows[0][0] * x + rows[0][1] * y + rows[0][2] * z + rows[0][3]) / denominator;
  const projectedY = (rows[1][0] * x + rows[1][1] * y + rows[1][2] * z + rows[1][3]) / denominator;
  if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) return null;
  return {
    name: point.name,
    x: projectedX,
    y: projectedY,
  };
}

function normalizedWorldKeypoints(keypoints3d) {
  const valid = keypoints3d.filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
  if (!valid.length) return {};
  const xs = valid.map((point) => Number(point.x));
  const ys = valid.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.0001);
  const spanY = Math.max(maxY - minY, 0.0001);
  return Object.fromEntries(valid.map((point) => [
    point.name,
    {
      x: 0.15 + ((Number(point.x) - minX) / spanX) * 0.7,
      y: 0.10 + ((Number(point.y) - minY) / spanY) * 0.8,
    },
  ]));
}

function boxingMetrics(points) {
  const byName = Object.fromEntries(points.map((point) => [point.name, point]));
  const required = ["nose", "left_wrist", "right_wrist", "left_shoulder", "right_shoulder", "left_hip", "right_hip"];
  if (required.some((name) => !byName[name] || byName[name].score <= 0.2)) {
    return { guard: 0, punch: 0, posture: 0, left_guard: 0, right_guard: 0, extension: 0 };
  }
  const noseY = byName.nose.y;
  const shoulderY = (byName.left_shoulder.y + byName.right_shoulder.y) / 2;
  const leftGuard = guardScore(byName.left_wrist, byName.left_shoulder, noseY, shoulderY);
  const rightGuard = guardScore(byName.right_wrist, byName.right_shoulder, noseY, shoulderY);
  const guard = Math.round((leftGuard + rightGuard) / 2);
  const useWorld = worldPointsAvailable([
    byName.left_wrist,
    byName.right_wrist,
    byName.left_shoulder,
    byName.right_shoulder,
    byName.left_hip,
    byName.right_hip,
  ]);
  const shoulderSpan = useWorld
    ? distance3d(byName.left_shoulder, byName.right_shoulder)
    : Math.abs(byName.right_shoulder.x - byName.left_shoulder.x);
  const leftExtension2d = useWorld ? punchExtension3d(byName.left_wrist, byName.left_shoulder, shoulderSpan) : punchExtension(byName.left_wrist, byName.left_shoulder, shoulderSpan);
  const rightExtension2d = useWorld ? punchExtension3d(byName.right_wrist, byName.right_shoulder, shoulderSpan) : punchExtension(byName.right_wrist, byName.right_shoulder, shoulderSpan);
  const leftDepth = Number(byName.left_wrist.depth_forward || 0);
  const rightDepth = Number(byName.right_wrist.depth_forward || 0);
  const leftExtension = leftDepth > 0 ? clampScore(leftExtension2d * 0.38 + leftDepth * 0.62) : leftExtension2d;
  const rightExtension = rightDepth > 0 ? clampScore(rightExtension2d * 0.38 + rightDepth * 0.62) : rightExtension2d;
  const activePunch = byName.left_wrist.depth_active ? "left" : byName.right_wrist.depth_active ? "right" : "";
  const extension = activePunch === "left"
    ? leftExtension
    : activePunch === "right"
      ? rightExtension
      : Math.max(leftExtension, rightExtension);
  const punch = clampScore(100 - Math.max(0, extension - 82) * 1.6 - Math.max(0, 58 - guard) * 0.45);
  const centerX = (axisValue(byName.left_hip, "x", useWorld) + axisValue(byName.right_hip, "x", useWorld)) / 2;
  const shoulderCenterX = (axisValue(byName.left_shoulder, "x", useWorld) + axisValue(byName.right_shoulder, "x", useWorld)) / 2;
  const shoulderTilt = Math.abs(axisValue(byName.left_shoulder, "y", useWorld) - axisValue(byName.right_shoulder, "y", useWorld));
  const posture = clampScore(100 - Math.abs(centerX - shoulderCenterX) * 260 - shoulderTilt * 210);
  return { guard, punch, posture, left_guard: leftGuard, right_guard: rightGuard, extension, left_extension: leftExtension, right_extension: rightExtension, active_punch: activePunch };
}

function boxingFeedback(metrics, status) {
  const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (status === "no_person") {
    const logs = [
      { label: "", text: "카메라 안에 전신이 들어오도록 한 걸음 뒤로 이동하세요.", time },
      { label: "", text: "양손과 어깨가 화면에 보이면 인식이 안정됩니다.", time },
    ];
    return { action: "자세 인식 대기", feedback: logs[0].text, logs };
  }
  const logs = [
    { label: "", text: guardFeedback(metrics.left_guard, metrics.right_guard), time },
    { label: "", text: punchFeedback(metrics.extension, metrics.guard), time },
    { label: "", text: postureFeedback(metrics.posture), time },
  ];
  const weakest = [
    ["가드 유지", metrics.guard, logs[0].text],
    ["펀치 회수", metrics.punch, logs[1].text],
    ["자세 안정", metrics.posture, logs[2].text],
  ].sort((a, b) => a[1] - b[1])[0];
  return { action: weakest[0], feedback: weakest[2], logs };
}

function guardFeedback(leftGuard, rightGuard) {
  if (leftGuard < 62 && rightGuard < 62) return "양손 가드가 내려갔습니다. 손을 턱과 광대 높이로 올리세요.";
  if (leftGuard < rightGuard - 12) return "왼손 가드가 낮습니다. 잽 손을 얼굴 쪽으로 빠르게 복귀하세요.";
  if (rightGuard < leftGuard - 12) return "오른손 가드가 낮습니다. 반대손은 턱 옆에 붙여두세요.";
  return "가드 높이가 안정적입니다. 시선은 정면에 고정하세요.";
}

function punchFeedback(extension, guard) {
  if (extension > 82) return "펀치가 뻗어진 상태입니다. 타격 후 바로 가드로 회수하세요.";
  if (guard < 70) return "펀치 준비 전 가드를 먼저 올리세요.";
  return "펀치 대기 자세가 좋습니다. 잽은 뻗고 바로 회수하세요.";
}

function postureFeedback(posture) {
  if (posture < 68) return "상체 중심이 흔들립니다. 골반 위에 어깨를 맞추고 무릎 탄성을 유지하세요.";
  return "상체와 골반 중심이 안정적입니다. 발 간격을 유지하세요.";
}

function guardScore(wrist, shoulder, noseY, shoulderY) {
  const verticalTarget = shoulderY - (shoulderY - noseY) * 0.25;
  const heightScore = clampScore(100 - Math.max(0, wrist.y - verticalTarget) * 360);
  const widthScore = clampScore(100 - Math.abs(wrist.x - shoulder.x) * 210);
  return Math.round(heightScore * 0.72 + widthScore * 0.28);
}

function punchExtension(wrist, shoulder, shoulderSpan) {
  return clampScore((Math.abs(wrist.x - shoulder.x) / Math.max(shoulderSpan, 0.1)) * 105);
}

function punchExtension3d(wrist, shoulder, shoulderSpan) {
  return clampScore((distance3d(wrist, shoulder) / Math.max(shoulderSpan, 0.05)) * 95);
}

function worldPointsAvailable(points) {
  return points.every((point) => ["world_x", "world_y", "world_z"].every((key) => Number.isFinite(Number(point?.[key]))));
}

function axisValue(point, axis, useWorld = false) {
  const key = useWorld ? `world_${axis}` : axis;
  return Number(point?.[key] || 0);
}

function distance3d(first, second) {
  const dx = axisValue(first, "x", true) - axisValue(second, "x", true);
  const dy = axisValue(first, "y", true) - axisValue(second, "y", true);
  const dz = axisValue(first, "z", true) - axisValue(second, "z", true);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function averageKeypointScore(points) {
  return points.length ? points.reduce((total, point) => total + point.score, 0) / points.length : 0;
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampScore(value) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function updateHud(packet) {
  const events = ingestPoseFeedback(packet);
  maybeAdvanceTrainingInstruction(packet, events);
  $("#targetAction").textContent = currentInstructionText(packet.action);
  $("#scoreValue").textContent = sessionScoreLabel();
  $("#confidenceValue").textContent = `${packet.pose_mode || "2D"} confidence ${packet.confidence}`;
  const statusPrefix = packet.pose_space === "world_3d"
    ? "3D fused"
    : packet.pose_space === "screen_2d_depth_assist"
      ? "2.5D depth assist"
    : packet.pose_mode === "2D source"
      ? `2D source${state.pose3dStatus ? ` / 3D ${state.pose3dStatus}` : ""}`
      : packet.view_angle;
  $("#cameraStatus").textContent = `${packet.camera_id} · ${statusPrefix} · ${packet.status}`;
}

function renderFeedbackLog(items) {
  $("#feedbackLog").innerHTML = items.slice(0, 2).map((item) => `
    <div class="feedback-entry">
      <span>${item.text}</span>
    </div>
  `).join("");
}

function fallbackFeedbackLog(packet) {
  const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const action = currentInstructionText(packet.action);
  return [
    { label: "", text: packet.feedback, time },
    { label: "", text: `${action} 동작에 집중하세요.`, time },
  ];
}

function resizeCanvas() {
  const canvas = $("#skeletonCanvas");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
}

function drawSkeleton() {
  const canvas = $("#skeletonCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawGrid(ctx, w, h);
  if (!state.cameraReady || !state.latestPose || state.latestPose.status === "no_person") {
    drawOfflineMark(ctx, w, h);
    return;
  }
  const packet = state.latestPose;
  const points = posePointsForCanvas(packet, w, h);
  const bones = [
    ["nose", "left_shoulder"], ["nose", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["left_shoulder", "right_shoulder"], ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"], ["left_hip", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
  ];
  ctx.lineWidth = 4 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = "rgba(46, 232, 255, 0.92)";
  ctx.shadowColor = "rgba(46, 232, 255, 0.75)";
  ctx.shadowBlur = 18;
  bones.forEach(([a, b]) => {
    if (!points[a] || !points[b]) return;
    ctx.beginPath();
    ctx.moveTo(points[a].x, points[a].y);
    ctx.lineTo(points[b].x, points[b].y);
    ctx.stroke();
  });
  Object.values(points).forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = "#e8fbff";
    ctx.arc(point.x, point.y, 6 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawOfflineMark(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(99, 234, 255, 0.18)";
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.setLineDash([10, 10]);
  ctx.strokeRect(w * 0.32, h * 0.18, w * 0.36, h * 0.64);
  ctx.restore();
}

function drawGrid(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(99, 234, 255, 0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function resetHud() {
  stopPoseTracking();
  state.latestPose = null;
  resetTrainingInstruction();
  $("#targetAction").textContent = "카메라 연결 대기";
  $("#scoreValue").textContent = "--";
  $("#confidenceValue").textContent = "confidence --";
  $("#cameraStatus").textContent = state.cameraReady ? "카메라 준비됨" : "카메라 연결 안됨";
  $("#feedbackText").textContent = "카메라가 연결되면 실시간 코칭을 시작할 수 있습니다.";
  $("#cameraPreview").classList.remove("hidden");
  state.feedbackLog = [];
  renderFeedbackLog([]);
  updateSessionControls();
  if ($("#hud").classList.contains("hidden")) return;
  $("#cameraOffline").classList.toggle("hidden", state.cameraReady);
  drawSkeleton();
}
