function currentTrainingMember() {
  if (state.user?.role === "MEMBER") {
    return state.profile ? { ...state.profile, username: state.user.username, email: state.user.email } : null;
  }
  return state.members.find((member) => member.id === state.selectedMemberId) || state.members[0] || state.profile || null;
}

let sessionCameraConfigKey = "";

async function startSessionCameras(cameraConfig = activeCameraConfig()) {
  const config = cameraConfig.length ? cameraConfig : [primaryCameraConfig()];
  const configKey = JSON.stringify(config);
  if (sessionCameraConfigKey === configKey && state.sessionCameraSources.length === config.length && state.sessionCameraSources.every(source => source.stream.getVideoTracks().length > 0 && source.stream.getVideoTracks().every(track => track.readyState === "live") && source.video.videoWidth > 0)) return state.sessionCameraSources;
  stopCamera();
  const sources = [];
  const usedDevices = new Set();
  try {
    for (const configured of config) {
      const camera = { ...configured };
      if (!camera.device_id && sources.length) {
        const available = (await enumerateVideoDevices()).find(device => !usedDevices.has(device.deviceId));
        if (!available) throw new Error("설정한 대수만큼 카메라가 연결되어 있지 않습니다.");
        camera.device_id = available.deviceId;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraVideoConstraints(camera),
        audio: false,
      });
      const video = sources.length === 0 ? $("#cameraPreview") : document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      sources.push({
        camera,
        stream,
        video,
      });
      const actualDevice = stream.getVideoTracks()[0]?.getSettings().deviceId || camera.device_id;
      if (actualDevice && usedDevices.has(actualDevice)) throw new Error("같은 카메라를 중복 선택했습니다.");
      if (actualDevice) {
        usedDevices.add(actualDevice);
        camera.device_id = actualDevice;
      }
      await waitForVideoReady(video);
    }
    const preview = $("#cameraPreview");
    preview.classList.remove("hidden");
    $("#cameraFallback").classList.add("hidden");
    $("#cameraOffline").classList.add("hidden");
    state.sessionCameraSources = sources;
    sessionCameraConfigKey = configKey;
    state.recordingStream = sources[0]?.stream || null;
    renderCameraMiniOverlay(sources);
    window.MotionSession?.start(preview);
    return sources;
  } catch (error) {
    stopSessionCameraSources(sources);
    clearCameraMiniOverlay();
    $("#cameraFallback").classList.remove("hidden");
    $("#cameraOffline").classList.remove("hidden");
    $("#sessionMessage").textContent = `Camera start failed: ${error.message || error}`;
    return [];
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
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      reject(new Error("카메라 미리보기를 시작할 수 없습니다."));
    };
    const done = () => {
      cleanup();
      video.play().then(resolve).catch(reject);
    };
    const timeout = setTimeout(failed, 10000);
    if (video.readyState >= 2 && video.videoWidth > 0) {
      done();
      return;
    }
    video.addEventListener("loadedmetadata", done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

function stopCamera() {
  window.MotionSession?.stop();
  sessionCameraConfigKey = "";
  const stopped = stopSessionCameraSources();
  clearCameraMiniOverlay();
  const stream = $("#cameraPreview").srcObject;
  if (stream && !stopped.has(stream)) {
    stream.getTracks().forEach((track) => track.stop());
  }
  $("#cameraPreview").srcObject = null;
  $("#cameraPreview").classList.remove("hidden");
  $("#cameraFallback").classList.remove("hidden");
  $("#cameraOffline").classList.remove("hidden");
  $("#cameraStatus").textContent = "카메라 대기";
  state.recordingStream = null;
  state.sessionCameraSources = [];
}

let recordingCapture = null;

function startRecording() {
  state.recordingError = "";
  state.recordedChunks = [];
  if (!window.MediaRecorder) {
    state.recordingError = "이 브라우저는 운동 녹화를 지원하지 않습니다.";
    $("#sessionMessage").textContent = `${state.recordingError} 세션 기록만 저장됩니다.`;
    return;
  }
  if (!state.recordingStream) {
    state.recordingError = "카메라 스트림이 없습니다.";
    $("#sessionMessage").textContent = `${state.recordingError} 세션 기록만 저장됩니다.`;
    return;
  }
  const recorder = new MediaRecorder(state.recordingStream, preferredRecordingOptions());
  const capture = { recorder, chunks: state.recordedChunks, requestedStop: false, interrupted: false, saving: null };
  capture.stopped = new Promise(resolve => {
    recorder.addEventListener("dataavailable", event => {
      if (event.data.size > 0) capture.chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      capture.interrupted = true;
      $("#sessionMessage").textContent = "녹화 오류로 중단되었습니다. 운동 종료 시 수신한 녹화 데이터를 보존합니다.";
    });
    recorder.addEventListener("stop", () => {
      if (!capture.requestedStop) {
        capture.interrupted = true;
        $("#sessionMessage").textContent = "녹화가 중단되었습니다. 운동을 종료하여 수신한 데이터를 저장하세요.";
      }
      resolve();
    }, { once: true });
  });
  recordingCapture = capture;
  state.recorder = recorder;
  try { recorder.start(1000); }
  catch (error) { recordingCapture = null; state.recorder = null; throw error; }
}

function preferredRecordingOptions() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mimeType = candidates.find(candidate => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : {};
}

async function stopRecording(sessionId) {
  const capture = recordingCapture;
  if (!capture) return null;
  if (capture.saving) return capture.saving;
  capture.saving = (async () => {
    if (capture.recorder.state !== "inactive") {
      capture.requestedStop = true;
      capture.recorder.stop();
    }
    await capture.stopped;
    const blob = new Blob(capture.chunks, { type: capture.recorder.mimeType || "video/webm" });
    if (!blob.size) {
      state.recordingError = "녹화 데이터가 없습니다. 카메라와 녹화 지원 상태를 확인하세요.";
      throw new Error(state.recordingError);
    }
    const recording = {
      id: sessionId, mimeType: blob.type, size: blob.size, savedAt: Date.now(),
      persisted: true, interrupted: capture.interrupted, blob,
    };
    try { await saveRecording(recording); }
    catch (error) { recording.persisted = false; console.warn(error); }
    return recording;
  })();
  try { return await capture.saving; }
  finally {
    if (recordingCapture === capture) {
      recordingCapture = null;
      state.recorder = null;
      state.recordedChunks = [];
    }
  }
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
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("recordings", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("녹화 저장이 취소되었습니다."));
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore("recordings").put(recording);
    });
  } finally {
    db.close();
  }
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
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("recordings", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("녹화 삭제 트랜잭션이 취소되었습니다."));
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore("recordings").delete(sessionId);
    });
  } finally { db.close(); }
}

function playRecording(sessionId) {
  const recording = state.localRecordings[sessionId];
  if (!recording) throw new Error("이 장치의 녹화 파일을 찾을 수 없습니다.");
  const url = URL.createObjectURL(recording.blob);
  const viewer = window.open("", "_blank", "width=900,height=640");
  if (!viewer) { URL.revokeObjectURL(url); throw new Error("녹화 창이 차단됐습니다. 팝업을 허용하고 다시 시도하세요."); }
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
    if (state.activeSessionId) stopSession('timer').catch(showSessionError);
  }, durationSeconds * 1000);
}

function stopRoundTimer() {
  if (state.roundTimer) clearTimeout(state.roundTimer);
  state.roundTimer = null;
}

function updateSessionControls() {
  const isActive = Boolean(state.activeSessionId);
  const coaching = window.RoundCoach?.isBlocking();
  $("#sessionState").textContent = isActive ? (state.recorder?.state === "recording" ? "녹화 중" : "세션 진행 중") : "대기 중";
  $("#sessionTimer").textContent = isActive ? sessionTimerText() : "00:00";
  $("#startSessionHud").disabled = isActive || state.sessionBusy || coaching;
  $("#stopSessionHud").disabled = !isActive || state.sessionBusy;
  $("#retryCamera").disabled = isActive || state.sessionBusy || coaching;
}

function sessionTimerText() {
  const elapsedSeconds = Math.max(0, Math.floor((state.pendingSessionEnd?.stoppedAt || Date.now() / 1000) - state.activeSessionStartedAt));
  const durationSeconds = sessionDurationSecondsFromCenter();
  return `${formatSeconds(elapsedSeconds)} / ${formatSeconds(durationSeconds)}`;
}

function formatSeconds(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}


function showSessionError(error) {
  $("#sessionMessage").textContent = error.message || String(error);
}

async function previewCamera() {
  if (state.activeSessionId || state.sessionBusy) return;
  state.sessionBusy = true;
  updateSessionControls();
  try {
    const sources = await startSessionCameras();
    if (sources.length) $("#cameraStatus").textContent = `카메라 ${sources.length}대 연결됨`;
  } finally {
    state.sessionBusy = false;
    updateSessionControls();
  }
}

async function startSession() {
  if (state.activeSessionId || state.sessionBusy || window.RoundCoach?.isBlocking()) return;
  const member = currentTrainingMember();
  if (!member) return showSessionError(new Error("운동할 회원을 선택해주세요."));
  if (state.pendingSessionStart?.actorId !== state.user.id) state.pendingSessionStart = null;
  if (state.pendingSessionStart && state.pendingSessionStart.body.user_id !== member.user_id) {
    return showSessionError(new Error("이전 회원의 세션 시작 결과를 확인하지 못했습니다. 해당 회원을 선택하고 시작을 다시 눌러주세요."));
  }
  state.sessionBusy = true;
  updateSessionControls();
  try {
    const cameraConfig = state.pendingSessionStart?.body.camera_config || activeCameraConfig();
    const sources = await startSessionCameras(cameraConfig);
    if (!sources.length) return;
    state.pendingSessionStart ||= {
      actorId: state.user.id,
      body: { user_id: member.user_id, focus: "free_training", camera_config: sources.map(source => source.camera), request_id: crypto.randomUUID() },
    };
    const created = await api("/sessions", {
      method: "POST",
      body: JSON.stringify(state.pendingSessionStart.body),
    });
    state.pendingSessionStart = null;
    state.sessions = [created.session, ...state.sessions.filter(session => session.id !== created.session.id)];
    if (created.session.ended_at) {
      stopCamera();
      return showSessionError(new Error("해당 세션은 이미 종료되었습니다. 새 운동을 시작하려면 시작을 다시 눌러주세요."));
    }
    state.activeSessionId = created.session.id;
    state.pendingSessionEnd = null;
    state.activeSessionStartedAt = created.session.started_at;
    await window.MotionSession?.beginRound(member.stance === 'southpaw' ? 'southpaw' : 'orthodox', state.settings.motionFeedback === 'event' ? 'event' : 'summary');
    $("#cameraStatus").textContent = `카메라 ${sources.length}대 연결됨`;
    $("#sessionMessage").textContent = "운동 시간과 녹화를 저장합니다. 동작 점수는 시험 판정입니다.";
    if (!state.motionReportVersions?.includes(1)) $("#sessionMessage").textContent = "이 서버는 동작 점수 저장을 지원하지 않습니다. 운동 시간과 녹화만 저장합니다. 서버/앱 업데이트가 필요합니다.";
    try { startRecording(); } catch (error) { state.recordingError = error.message; showSessionError(new Error(`녹화 시작 실패: ${error.message}. 세션 기록은 유지됩니다.`)); }
    startSessionTimer();
    startRoundTimer();
    playTone(660);
  } catch (error) {
    if (!state.activeSessionId) stopCamera();
    showSessionError(error);
  } finally {
    state.sessionBusy = false;
    updateSessionControls();
  }
}

async function stopSession(reason = 'manual') {
  if (!state.activeSessionId || state.sessionBusy) return;
  state.sessionBusy = true;
  updateSessionControls();
  const sessionId = state.activeSessionId;
  try {
    stopRoundTimer();
    stopSessionTimer();
    if (!state.pendingSessionEnd || state.pendingSessionEnd.sessionId !== sessionId) {
      const pending = {sessionId,stoppedAt:Date.now()/1000,reason:reason === 'timer' ? 'timer' : 'manual',body:{}};
      try {
        const report = window.MotionSession?.finishRound();
        if (report && state.motionReportVersions?.includes(report.version)) pending.body.motion_report = report;
        else if (report) pending.analysisError = true;
      } catch (_) {
        pending.analysisError = true;
      }
      state.pendingSessionEnd = pending;
    }
    const pendingEnd = state.pendingSessionEnd;
    try {
      const recording = await stopRecording(sessionId);
      if (recording) state.localRecordings[sessionId] = recording;
    } catch (error) {
      state.recordingError = error.message || '녹화 저장 실패';
    }
    stopCamera();
    const result = await api(`/sessions/${sessionId}/end`, { method: "PATCH", body: JSON.stringify(pendingEnd.body) });
    state.sessions = state.sessions.map(session => session.id === sessionId ? result.session : session);
    state.activeSessionId = "";
    stopSessionTimer();
    $("#sessionMessage").textContent = state.localRecordings[sessionId]?.persisted === false
      ? "운동 기록은 저장했지만 녹화 파일을 장치에 저장하지 못했습니다. 이 페이지를 닫기 전에 회원 기록에서 다운로드해주세요."
      : state.recordingError
        ? `운동 기록만 저장했습니다. 녹화 저장 실패: ${state.recordingError}`
      : state.localRecordings[sessionId]?.interrupted
        ? "운동 기록과 중단 전 녹화를 저장했습니다. 녹화가 전체 운동을 포함하지 않을 수 있습니다."
        : "운동 기록과 라운드 결과를 저장했습니다.";
    notifyUser("운동 세션 종료", "운동 기록이 저장되었습니다.");
    playTone(420);
    window.RoundCoach?.show(result.session, { onNext: startSession, onChange: updateSessionControls, endReason:pendingEnd.reason });
    if (pendingEnd.analysisError) $("#sessionMessage").textContent += ' 동작 분석 결과는 저장하지 못했습니다.';
    state.pendingSessionEnd = null;
  } catch (error) {
    stopCamera();
    showSessionError(new Error(`세션 종료 저장 실패: ${error.message}. 종료 버튼으로 다시 시도해주세요.`));
  } finally {
    state.sessionBusy = false;
    updateSessionControls();
  }
}
