function defaultSettings() {
  return {
    theme: "dark",
    notifications: false,
    voice: false,
    voiceLanguage: "ko-KR",
    sound: true,
    feedbackCooldownSeconds: 6,
  };
}

function loadSettings() {
  return { ...defaultSettings(), ...readJsonStorage(SETTINGS_KEY, {}) };
}

function saveSettings() {
  writeJsonStorage(SETTINGS_KEY, state.settings);
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

function defaultCameraSetup() {
  return {
    targetCount: 1,
    cameras: [
      {
        camera_id: "cam_front_01",
        label: "정면",
        view_angle: "front",
        role: "primary",
        enabled: true,
        device_id: "",
        calibrated: false,
        calibration_status: "missing",
      },
      {
        camera_id: "cam_side_01",
        label: "측면",
        view_angle: "side_90",
        role: "depth",
        enabled: false,
        device_id: "",
        calibrated: false,
        calibration_status: "missing",
      },
      {
        camera_id: "cam_rear_45_01",
        label: "후면 45도",
        view_angle: "rear_45",
        role: "occlusion_guard",
        enabled: false,
        device_id: "",
        calibrated: false,
        calibration_status: "missing",
      },
    ],
  };
}

function loadCameraSetup() {
  return normalizeCameraSetup(readJsonStorage(CAMERA_SETUP_KEY, null));
}

function normalizeCameraSetup(setup) {
  const defaults = defaultCameraSetup();
  const source = setup && typeof setup === "object" ? setup : {};
  const targetCount = clampCameraCount(Number(source.targetCount || defaults.targetCount));
  const sourceCameras = Array.isArray(source.cameras) ? source.cameras : [];
  const cameras = defaults.cameras.map((fallback, index) => {
    const incoming = sourceCameras[index] || {};
    const camera = { ...fallback, ...incoming };
    camera.enabled = index < targetCount;
    camera.device_id = index === 0 ? "" : String(camera.device_id || "");
    camera.calibrated = Boolean(camera.calibrated);
    camera.calibration_status = camera.calibrated ? "ready" : "missing";
    return camera;
  });
  return { targetCount, cameras };
}

function clampCameraCount(value) {
  return Math.max(1, Math.min(3, Number(value) || 1));
}

function saveCameraSetup() {
  state.cameraSetup = normalizeCameraSetup(state.cameraSetup);
  writeJsonStorage(CAMERA_SETUP_KEY, state.cameraSetup);
}

function loadMemberCalibrations() {
  return readJsonStorage(MEMBER_CALIBRATION_KEY, {}) || {};
}

function saveMemberCalibrations() {
  writeJsonStorage(MEMBER_CALIBRATION_KEY, state.memberCalibrations);
}

function normalizeMemberCalibrationRecord(record) {
  if (!record) return null;
  const bodyScale = record.body_scale || {};
  const cameraConfig = record.camera_config || record.cameras || record.calibration?.cameras || [];
  const estimatedReach = Number(record.estimated_reach_cm || bodyScale.estimated_reach_cm || 0);
  return {
    completed: Boolean(record.completed ?? record.ready),
    completed_at: record.completed_at || Date.now(),
    status: record.status || record.calibration?.status || "",
    sample_count: Number(record.sample_count || 0),
    estimated_reach_cm: estimatedReach || null,
    body_scale: bodyScale,
    camera_config: cameraConfig,
    calibration: record.calibration || null,
  };
}

async function hydrateMemberCalibrations() {
  const profiles = state.members.length ? state.members : state.profile ? [state.profile] : [];
  await Promise.all(profiles.map(async (member) => {
    if (!member?.id) return;
    try {
      const result = await api(`/members/${member.id}/calibration`);
      const calibration = normalizeMemberCalibrationRecord(result.calibration);
      if (calibration) {
        state.memberCalibrations[memberCalibrationKey(member)] = calibration;
      }
    } catch (error) {
      console.warn(error);
    }
  }));
  saveMemberCalibrations();
}

function memberCalibrationKey(member) {
  return member?.user_id || state.user?.id || "";
}

function memberCalibration(member) {
  const key = memberCalibrationKey(member);
  return key ? state.memberCalibrations[key] : null;
}

function isMemberCalibrated(member) {
  return Boolean(memberCalibration(member)?.completed);
}

function applyStoredMemberCalibration(member) {
  const calibration = memberCalibration(member);
  if (!calibration?.camera_config?.length) return false;
  const calibratedById = Object.fromEntries(calibration.camera_config.map((camera) => [camera.camera_id, camera]));
  let changed = false;
  state.cameraSetup.cameras = state.cameraSetup.cameras.map((camera) => {
    const calibrated = calibratedById[camera.camera_id];
    if (!calibrated) return camera;
    changed = true;
    return {
      ...camera,
      calibrated: Boolean(calibrated.calibrated),
      calibration_status: calibrated.calibration_status || "ready",
      calibrated_at: calibrated.calibrated_at || calibration.completed_at || Date.now(),
      projection_matrix: calibrated.projection_matrix || null,
      calibration: calibrated.calibration || null,
    };
  });
  if (changed) saveCameraSetup();
  return changed;
}

function activeCameraConfig() {
  return normalizeCameraSetup(state.cameraSetup).cameras
    .filter((camera) => camera.enabled)
    .map((camera) => ({
      camera_id: camera.camera_id,
      label: camera.label,
      view_angle: camera.view_angle,
      role: camera.role,
      enabled: true,
      device_id: camera.device_id || "",
      calibrated: Boolean(camera.calibrated),
      calibration_status: camera.calibrated ? "ready" : "missing",
      calibrated_at: camera.calibrated_at || null,
      projection_matrix: camera.projection_matrix || null,
      calibration: camera.calibration || null,
    }));
}

function cameraRigSummary(cameraConfig = activeCameraConfig()) {
  const enabled = cameraConfig.filter((camera) => camera.enabled !== false);
  if (enabled.length < 2) {
    return { mode: "2D", status: "single camera", ready: true };
  }
  return { mode: "2.5D", status: `${enabled.length} camera depth assist`, ready: true };
  const calibrated = enabled.filter((camera) => camera.calibrated);
  if (enabled.length < 2) {
    return { mode: "2D", status: "단일 카메라", ready: true };
  }
  if (calibrated.length >= 2) {
    return { mode: "3D", status: `${calibrated.length}/${enabled.length}대 보정 완료`, ready: true };
  }
  return { mode: "3D 준비", status: `${calibrated.length}/${enabled.length}대 보정 완료`, ready: false };
}

function primaryCameraConfig() {
  return activeCameraConfig()[0] || defaultCameraSetup().cameras[0];
}

function cameraDisplayLabel(camera = {}) {
  const labels = { Front: "정면", Side: "측면", "Rear 45": "후면 45도" };
  return labels[camera.label] || camera.label || camera.camera_id || "카메라";
}

function renderCameraRigSettings() {
  const setup = normalizeCameraSetup(state.cameraSetup);
  const summary = cameraRigSummary(setup.cameras.filter((camera) => camera.enabled));
  return `
      <article class="admin-board settings-panel camera-rig-panel">
        <div class="settings-heading">
          <small>카메라 구성</small>
          <h3>2D / 2.5D 카메라 설정</h3>
          <p>카메라 1대는 메인 2D 스켈레톤을 사용합니다. 2대 이상은 메인 화면 스켈레톤에 보조 카메라의 깊이 힌트를 더해 펀치 판정을 안정화합니다.</p>
        </div>
        <div class="segmented camera-count-segment">
          ${[1, 2, 3].map((count) => `<button class="${setup.targetCount === count ? "active" : ""}" data-camera-count="${count}">${count}대</button>`).join("")}
        </div>
        <div class="camera-rig-status ${summary.ready ? "ready" : "pending"}">
          <span>${summary.mode}</span>
          <strong>${summary.status}</strong>
        </div>
        <div class="camera-grid">
          ${setup.cameras.map((camera, index) => renderCameraConfigRow(camera, index, setup.targetCount)).join("")}
        </div>
        <div class="calibration-flow">
          <div>
            <small>인체 보정</small>
            <p>활성화된 모든 카메라에서 동기화된 관절점을 수집하고 OpenCV로 카메라 위치 관계를 계산한 뒤, 이 카메라 구성에 투영 행렬을 저장합니다.</p>
          </div>
          <div class="calibration-actions">
            <button id="scanCameraDevices" class="ghost">카메라 검색</button>
            <button id="runHumanCalibration" ${state.calibrationRunning ? "disabled" : ""}>${state.calibrationRunning ? "보정 진행 중..." : "인체 보정 시작"}</button>
            <button id="resetCalibration" class="ghost">보정 초기화</button>
          </div>
        </div>
        <p id="calibrationMessage" class="form-message settings-message">${state.calibrationMessage}</p>
      </article>`;
}

function renderCameraConfigRow(camera, index, targetCount) {
  const disabled = index >= targetCount;
  return `
    <div class="camera-config-row ${disabled ? "disabled" : ""}">
      <div class="camera-config-title">
        <span>${escapeHtml(cameraDisplayLabel(camera))}</span>
        <strong>${disabled ? "사용 안 함" : camera.calibrated ? "보정 완료" : "보정 필요"}</strong>
      </div>
      <label>
        <small>방향</small>
        <select data-camera-index="${index}" data-camera-field="view_angle" ${disabled ? "disabled" : ""}>
          ${cameraAngleOptions(camera.view_angle)}
        </select>
      </label>
      <label>
        <small>장치</small>
        <select data-camera-index="${index}" data-camera-field="device_id" ${disabled ? "disabled" : ""}>
          ${cameraDeviceOptions(camera.device_id)}
        </select>
      </label>
    </div>`;
}

function cameraAngleOptions(selected) {
  return [
    ["front", "정면"],
    ["side_45", "측면 45도"],
    ["side_90", "측면 90도"],
    ["rear_45", "후면 45도"],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function cameraDeviceOptions(selected) {
  const options = [`<option value="">자동 / 기본 카메라</option>`];
  state.videoDevices.forEach((device, index) => {
    const label = device.label || `카메라 ${index + 1}`;
    options.push(`<option value="${escapeHtml(device.deviceId)}" ${selected === device.deviceId ? "selected" : ""}>${escapeHtml(label)}</option>`);
  });
  return options.join("");
}

function bindCameraRigSettings() {
  document.querySelectorAll("[data-camera-count]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cameraSetup.targetCount = clampCameraCount(button.dataset.cameraCount);
      state.cameraSetup.cameras = state.cameraSetup.cameras.map((camera, index) => ({
        ...camera,
        enabled: index < state.cameraSetup.targetCount,
      }));
      state.calibrationMessage = "카메라 대수가 변경되었습니다.";
      saveCameraSetup();
      renderSettings();
    });
  });
  document.querySelectorAll("[data-camera-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.cameraIndex);
      const field = input.dataset.cameraField;
      state.cameraSetup.cameras[index][field] = input.value;
      if (field === "device_id" && index === 0) {
        state.cameraSetup.cameras[index].device_id = "";
      }
      if (field === "view_angle" || field === "device_id") {
        state.cameraSetup.cameras[index].calibrated = false;
        state.cameraSetup.cameras[index].calibration_status = "missing";
      }
      state.calibrationMessage = "카메라 설정을 저장했습니다. 보정을 다시 진행해 주세요.";
      saveCameraSetup();
      renderSettings();
    });
  });
  $("#scanCameraDevices")?.addEventListener("click", refreshVideoDevices);
}

async function refreshVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.calibrationMessage = "이 브라우저에서는 카메라 목록을 확인할 수 없습니다.";
    renderSettings();
    return;
  }
  state.videoDevices = await enumerateVideoDevices();
  state.calibrationMessage = `카메라 ${state.videoDevices.length}대를 찾았습니다.`;
  renderSettings();
}

async function enumerateVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}

function setCalibrationMessage(message) {
  state.calibrationMessage = message;
  const node = $("#calibrationMessage");
  if (node) node.textContent = message;
}

async function runHumanCalibration() {
  if (state.calibrationRunning) return;
  state.calibrationRunning = true;
  state.calibrationCancelled = false;
  state.calibrationMessage = "카메라를 준비하고 있습니다...";
  renderSettings();
  try {
    let cameraConfig = await ensureCalibrationDeviceAssignments();
    if (cameraConfig.length < 2) {
      throw new Error("3D 인체 보정을 위해 카메라를 2대 이상 선택해 주세요.");
    }
    openCalibrationModal(cameraConfig);
    const progress = (message) => {
      setCalibrationMessage(message);
      updateCalibrationModal(message);
    };
    progress("카메라를 여는 중입니다. 두 화면 모두에 발끝까지 보이도록 서서 A자 자세를 유지해 주세요.");
    await performHumanCalibration(cameraConfig, currentTrainingMember(), progress);
    updateCalibrationModal("보정이 저장되었습니다. 카메라 위치 관계와 리치 계산이 준비되었습니다.", "complete");
  } catch (error) {
    state.calibrationMessage = error.message;
    updateCalibrationModal(error.message, state.calibrationCancelled ? "cancelled" : "error");
  } finally {
    state.calibrationRunning = false;
    renderSettings();
  }
}

function openCalibrationModal(cameraConfig) {
  closeCalibrationModal();
  const modal = document.createElement("div");
  modal.id = "calibrationModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="confirm-modal calibration-modal" role="dialog" aria-modal="true" aria-labelledby="calibrationTitle">
      <div class="calibration-modal-heading">
        <div><small>3D 카메라 보정</small><strong id="calibrationTitle">촬영 전 위치를 맞춰 주세요</strong></div>
        <span id="calibrationPhase" class="calibration-phase preparing">준비 중</span>
      </div>
      <p class="calibration-intro">모든 카메라에 발끝까지 전신이 보이는 위치에 서세요. 정면 카메라를 바라보고 팔을 몸에서 살짝 떼어 A자 자세를 만든 뒤, 촬영이 시작되면 천천히 회전하세요.</p>
      <ol class="calibration-steps">
        <li><span>1</span> 모든 카메라 화면에 전신이 보이는지 확인하세요.</li>
        <li><span>2</span> 처음 몇 초 동안 중앙에서 A자 자세를 유지하세요.</li>
        <li><span>3</span> 팔이 계속 보이게 제자리에서 천천히 회전하세요.</li>
      </ol>
      <div id="calibrationPreviewGrid" class="calibration-preview-grid">
        ${cameraConfig.map((camera) => `<div class="calibration-preview-card waiting" data-calibration-camera="${escapeHtml(camera.camera_id)}"><span>${escapeHtml(cameraDisplayLabel(camera))}</span><small>카메라 연결 중...</small></div>`).join("")}
      </div>
      <div class="calibration-progress-panel"><strong id="calibrationProgressTitle">카메라 준비 중...</strong><p id="calibrationProgressMessage">브라우저가 요청하면 카메라 사용을 허용해 주세요.</p></div>
      <div class="modal-actions calibration-modal-actions">
        <button id="cancelHumanCalibration" type="button" class="ghost">보정 취소</button>
        <button id="closeCalibrationModal" type="button" class="hidden">완료</button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  $("#cancelHumanCalibration").addEventListener("click", () => {
    state.calibrationCancelled = true;
    updateCalibrationModal("촬영을 중지하고 카메라를 해제하고 있습니다...", "stopping");
  });
  $("#closeCalibrationModal").addEventListener("click", closeCalibrationModal);
}

function closeCalibrationModal() {
  $("#calibrationModal")?.remove();
}

function updateCalibrationModal(message, phase = "") {
  const modal = $("#calibrationModal");
  if (!modal) return;
  const isComplete = phase === "complete";
  const isStopped = phase === "error" || phase === "cancelled";
  const normalizedPhase = phase || (message.startsWith("자세 샘플 수집") ? "capturing" : message.startsWith("샘플 수집 완료") ? "computing" : "preparing");
  const labels = { preparing: "준비 중", capturing: "자세 수집 중", computing: "계산 중", stopping: "중지 중", complete: "완료", error: "확인 필요", cancelled: "중지됨" };
  const title = $("#calibrationProgressTitle");
  const detail = $("#calibrationProgressMessage");
  const badge = $("#calibrationPhase");
  if (title) title.textContent = labels[normalizedPhase] || "처리 중";
  if (detail) detail.textContent = message;
  if (badge) {
    badge.textContent = labels[normalizedPhase] || "처리 중";
    badge.className = `calibration-phase ${normalizedPhase}`;
  }
  const cancel = $("#cancelHumanCalibration");
  const close = $("#closeCalibrationModal");
  if (cancel) cancel.classList.toggle("hidden", isComplete || isStopped);
  if (close) close.classList.toggle("hidden", !isComplete && !isStopped);
}

async function ensureCalibrationDeviceAssignments() {
  const setup = normalizeCameraSetup(state.cameraSetup);
  const enabledIndexes = setup.cameras.map((camera, index) => camera.enabled ? index : -1).filter((index) => index >= 0);
  if (enabledIndexes.length < 2) return activeCameraConfig();
  state.videoDevices = await enumerateVideoDevices();
  if (state.videoDevices.length >= enabledIndexes.length) {
    enabledIndexes.forEach((cameraIndex, position) => {
      setup.cameras[cameraIndex].device_id = position === 0
        ? ""
        : (setup.cameras[cameraIndex].device_id || state.videoDevices[position]?.deviceId || "");
    });
    state.cameraSetup = setup;
    saveCameraSetup();
  }
  const cameraConfig = activeCameraConfig();
  const assigned = cameraConfig.slice(1).map((camera) => camera.device_id).filter(Boolean);
  const unique = new Set(assigned);
  if (assigned.length < Math.max(0, cameraConfig.length - 1) || unique.size < assigned.length) {
    throw new Error("카메라를 검색한 뒤, 활성화된 각 슬롯에 서로 다른 실제 카메라를 지정해 주세요.");
  }
  return cameraConfig;
}

async function downgradeCameraRigToAvailableDevices() {
  const devices = await enumerateVideoDevices();
  state.videoDevices = devices;
  const setup = normalizeCameraSetup(state.cameraSetup);
  const availableCount = Math.max(1, Math.min(setup.targetCount, devices.length || 1));
  setup.targetCount = availableCount;
  setup.cameras = setup.cameras.map((camera, index) => ({
    ...camera,
    enabled: index < availableCount,
    device_id: index === 0 ? "" : (index < devices.length ? devices[index].deviceId : ""),
    calibrated: index < availableCount ? camera.calibrated : false,
    calibration_status: index < availableCount && camera.calibrated ? "ready" : "missing",
  }));
  state.cameraSetup = setup;
  saveCameraSetup();
  return activeCameraConfig();
}

async function performHumanCalibration(cameraConfig, member, progress = setCalibrationMessage) {
  const heightCm = Number(member?.height_cm || 0);
  if (heightCm <= 0) {
    throw new Error("보정 전에 회원의 키를 입력해 주세요.");
  }
  const samples = await captureHumanCalibrationSamples(cameraConfig, progress);
  progress(`샘플 ${samples.length}개를 수집했습니다. 카메라 위치 관계와 리치를 계산하고 있습니다...`);
  const minimumSamples = cameraConfig.length >= 2 ? 12 : 4;
  const result = await api("/calibration/human", {
    method: "POST",
    body: JSON.stringify({
      camera_config: activeCameraConfig(),
      body_profile: { height_cm: heightCm },
      samples,
      minimum_samples: minimumSamples,
    }),
  });
  await applyHumanCalibrationResult(result.calibration, member);
  return result.calibration;
}

async function captureHumanCalibrationSamples(cameraConfig, progress = setCalibrationMessage) {
  const sources = await openCalibrationSources(cameraConfig);
  const samples = [];
  const durationMs = 9000;
  const sampleEveryMs = 240;
  const minimumObservations = cameraConfig.length >= 2 ? 2 : 1;
  const minimumSamples = cameraConfig.length >= 2 ? 12 : 4;
  let lastSampleAt = 0;
  const startedAt = Date.now();
  let calibrationLandmarker = null;
  try {
    calibrationLandmarker = await createCalibrationPoseLandmarker();
    while (Date.now() - startedAt < durationMs) {
      if (state.calibrationCancelled) {
        throw new Error("보정을 취소했습니다.");
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed - lastSampleAt >= sampleEveryMs) {
        lastSampleAt = elapsed;
        const observations = captureMediaPipeCalibrationObservations(sources, calibrationLandmarker);
        if (observations.length >= minimumObservations) {
          samples.push({
            sample_id: `human_calibration_${samples.length + 1}`,
            timestamp: Date.now() / 1000,
            observations,
          });
        }
        progress(`자세 샘플 수집 중: ${samples.length}/${minimumSamples}. 두 화면 안에서 A자 자세를 유지한 뒤 천천히 회전하세요.`);
      }
      await delay(60);
    }
  } finally {
    try {
      calibrationLandmarker?.close?.();
    } catch (error) {
      console.warn("Calibration pose graph close failed.", error);
    }
    stopCalibrationSources(sources);
  }
  if (samples.length < minimumSamples) {
    throw new Error(`유효한 샘플이 ${samples.length}개만 수집되었습니다. 모든 카메라에 전신이 보이도록 위치를 맞춰 주세요.`);
  }
  return samples;
}

function captureMediaPipeCalibrationObservations(sources, landmarker) {
  const timestamp = Date.now() / 1000;
  return sources.flatMap((source) => {
    const keypoints = calibrationKeypointsFromVideo(source.video, landmarker);
    return averageKeypointScore(keypoints) >= 0.45
      ? [{ camera_id: source.camera.camera_id, view_angle: source.camera.view_angle, timestamp, keypoints }]
      : [];
  });
}

async function openCalibrationSources(cameraConfig) {
  const sources = [];
  try {
    for (const camera of cameraConfig) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraVideoConstraints(camera),
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      await waitForVideoReady(video);
      const source = { camera, stream, video };
      sources.push(source);
      attachCalibrationPreview(source);
    }
    return sources;
  } catch (error) {
    stopCalibrationSources(sources);
    throw error;
  }
}

function stopCalibrationSources(sources) {
  sources.forEach((source) => {
    source.stream?.getTracks?.().forEach((track) => track.stop());
    source.video.srcObject = null;
  });
  detachCalibrationPreview();
}

function attachCalibrationPreview(source) {
  const card = document.querySelector(`[data-calibration-camera="${source.camera.camera_id}"]`);
  if (!card) return;
  card.classList.remove("waiting");
  card.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = cameraDisplayLabel(source.camera);
  source.video.className = "calibration-preview-video";
  card.append(source.video, label);
  source.video.play().catch(() => {});
}

function detachCalibrationPreview() {
  $("#calibrationPreviewGrid")?.replaceChildren();
}

function cameraVideoConstraints(camera = {}) {
  const constraints = {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 30, max: 30 },
  };
  if (camera.device_id) {
    constraints.deviceId = { exact: camera.device_id };
  }
  return constraints;
}

function calibrationKeypointsFromVideo(video, landmarker) {
  const result = landmarker.detect(video);
  const landmarks = result.landmarks && result.landmarks[0];
  return keypointsFromLandmarks(landmarks || []);
}

async function applyHumanCalibrationResult(calibration, member = null) {
  if (!calibration?.ready) {
    const errors = (calibration?.errors || []).join(" / ");
    throw new Error(errors || calibration?.status || "Calibration failed.");
  }
  const calibratedById = Object.fromEntries((calibration.cameras || []).map((camera) => [camera.camera_id, camera]));
  state.cameraSetup.cameras = state.cameraSetup.cameras.map((camera) => {
    const calibrated = calibratedById[camera.camera_id];
    if (!calibrated) return camera;
    return {
      ...camera,
      calibrated: Boolean(calibrated.calibrated),
      calibration_status: calibrated.calibration_status || "ready",
      calibrated_at: calibrated.calibrated_at || Date.now(),
      projection_matrix: calibrated.projection_matrix || null,
      calibration: calibrated.calibration || null,
    };
  });
  saveCameraSetup();
  await saveMemberCalibrationResult(member, calibration);
  state.calibrationMessage = `보정 완료: 자세 샘플 ${calibration.sample_count}개를 저장했습니다.`;
}

async function saveMemberCalibrationResult(member, calibration) {
  if (!member) return;
  const key = memberCalibrationKey(member);
  const bodyScale = calibration.body_scale || {};
  const estimatedReach = Number(bodyScale.estimated_reach_cm || 0);
  state.memberCalibrations[key] = {
    completed: true,
    completed_at: Date.now(),
    status: calibration.status,
    sample_count: calibration.sample_count,
    estimated_reach_cm: estimatedReach || null,
    body_scale: bodyScale,
    camera_config: calibration.cameras || [],
    calibration,
  };
  saveMemberCalibrations();
  if (member.id) {
    const result = await api(`/members/${member.id}/calibration`, {
      method: "POST",
      body: JSON.stringify({ calibration }),
    });
    const saved = normalizeMemberCalibrationRecord(result.calibration);
    if (saved) {
      state.memberCalibrations[key] = saved;
      saveMemberCalibrations();
    }
    if (result.member) updateLocalMemberProfile(result.member);
  }
}

function updateLocalMemberProfile(profile) {
  if (!profile) return;
  if (state.profile?.id === profile.id) {
    state.profile = { ...state.profile, ...profile };
  }
  state.members = state.members.map((member) => (member.id === profile.id ? { ...member, ...profile } : member));
}

function resetCalibration() {
  state.cameraSetup.cameras = state.cameraSetup.cameras.map((camera) => ({
    ...camera,
    calibrated: false,
    calibration_status: "missing",
    calibrated_at: null,
    projection_matrix: null,
    calibration: null,
  }));
  state.calibrationMessage = "보정 정보를 초기화했습니다.";
  saveCameraSetup();
  renderSettings();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderSettings() {
  const notificationState =
    "Notification" in window ? Notification.permission : "unsupported";
  $("#viewContent").innerHTML = `
    <section class="settings-layout">
      <article class="admin-board settings-panel">
        <div class="settings-heading">
          <small>Theme</small>
          <h3>테마 설정</h3>
        </div>
        <div class="segmented setting-segment">
          ${settingButton("dark", "다크테마", state.settings.theme === "dark", "theme")}
          ${settingButton("light", "라이트테마", state.settings.theme === "light", "theme")}
        </div>
      </article>

      <article class="admin-board settings-panel">
        <div class="settings-heading">
          <small>Alerts</small>
          <h3>알림/음성</h3>
          <p>세션 종료 알림과 실시간 음성 피드백을 제어합니다.</p>
        </div>
        <label class="setting-row">
          <span><strong>세션 알림</strong><small>${notificationState}</small></span>
          <input type="checkbox" data-setting-toggle="notifications" ${state.settings.notifications ? "checked" : ""} />
        </label>
        <label class="setting-row">
          <span><strong>음성 피드백</strong><small>코칭 문장을 읽어줍니다</small></span>
          <input type="checkbox" data-setting-toggle="voice" ${state.settings.voice ? "checked" : ""} />
        </label>
        <div class="settings-field">
          <span>음성 언어</span>
          <div class="segmented setting-segment">
            ${settingButton("ko-KR", "한국어", state.settings.voiceLanguage === "ko-KR", "voice-language")}
            ${settingButton("en-US", "English", state.settings.voiceLanguage === "en-US", "voice-language")}
          </div>
        </div>
        <label class="setting-row">
          <span><strong>효과음</strong><small>세션 시작/종료 신호음</small></span>
          <input type="checkbox" data-setting-toggle="sound" ${state.settings.sound ? "checked" : ""} />
        </label>
        <div class="settings-actions">
          <button id="requestNotifications">알림 권한 요청</button>
          <button id="testVoice">음성 테스트</button>
          <button id="testSound">효과음 테스트</button>
        </div>
      </article>

      ${renderCameraRigSettings()}

      <article class="admin-board settings-panel">
        <div class="settings-heading">
          <small>Account</small>
          <h3>계정 설정</h3>
          <p>${state.user.username} · ${roleLabel(state.user.role)} · ${escapeHtml(state.user.center_name || state.center.name)}</p>
        </div>
        <div class="account-summary">
          <span>현재 관리자</span>
          <strong>${escapeHtml(state.profile?.name || state.user.name || "")}</strong>
          <button id="editAccountInfo" class="ghost small-button">정보 수정</button>
        </div>
      </article>

      <div class="settings-footer">
        <button id="saveAllSettings">설정 저장</button>
        <button id="resetSettings" class="ghost">초기화</button>
      </div>
      <p id="settingsMessage" class="form-message settings-message">${state.settingsMessage}</p>
    </section>`;

  document.querySelectorAll("[data-setting-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.theme = button.dataset.settingTheme;
      setSettingsMessage("테마가 저장되었습니다.");
      saveSettings();
      renderApp();
    });
  });
  document.querySelectorAll("[data-setting-voice-language]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.voiceLanguage = button.dataset.settingVoiceLanguage;
      setSettingsMessage("음성 언어가 저장되었습니다.");
      saveSettings();
      renderSettings();
    });
  });
  document.querySelectorAll("[data-setting-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      state.settings[input.dataset.settingToggle] = input.checked;
      if (input.dataset.settingToggle === "notifications" && input.checked) requestNotifications();
      setSettingsMessage("설정이 저장되었습니다.");
      saveSettings();
      renderSettings();
    });
  });
  $("#requestNotifications").addEventListener("click", requestNotifications);
  $("#testVoice").addEventListener("click", () => speakText(voiceLine("음성 피드백이 켜져 있습니다.", "Voice feedback is enabled."), true));
  $("#testSound").addEventListener("click", () => playTone(720));
  bindCameraRigSettings();
  $("#editAccountInfo").addEventListener("click", openAccountModal);
  $("#saveAllSettings").addEventListener("click", saveAllSettings);
  $("#resetSettings").addEventListener("click", resetSettings);
  if (state.accountModalOpen) renderAccountModal();
}

function settingButton(value, label, active, name) {
  return `<button class="${active ? "active" : ""}" data-setting-${name}="${value}">${label}</button>`;
}

function setSettingsMessage(message) {
  state.settingsMessage = message;
}

function saveAllSettings() {
  saveSettings();
  setSettingsMessage("설정을 저장했습니다.");
  renderSettings();
}

function resetSettings() {
  state.settings = defaultSettings();
  saveSettings();
  setSettingsMessage("설정을 기본값으로 초기화했습니다.");
  renderApp();
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    state.settings.notifications = false;
    setSettingsMessage("이 브라우저는 알림을 지원하지 않습니다.");
    saveSettings();
    renderSettings();
    return;
  }
  const permission = await Notification.requestPermission();
  state.settings.notifications = permission === "granted";
  setSettingsMessage(permission === "granted" ? "알림 권한이 허용되었습니다." : "알림 권한이 허용되지 않았습니다.");
  saveSettings();
  renderSettings();
}

function notifyUser(title, body) {
  if (!state.settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

function speakText(text, force = false) {
  if (!force && !state.settings.voice) return;
  if (!("speechSynthesis" in window)) {
    setSettingsMessage("이 브라우저는 음성 합성을 지원하지 않습니다.");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceLanguage();
  utterance.voice = preferredVoice(utterance.lang);
  utterance.rate = 1;
  utterance.onstart = () => window.dispatchEvent(new CustomEvent("boxing-voice-start"));
  utterance.onboundary = (event) => window.dispatchEvent(new CustomEvent("boxing-voice-boundary", {
    detail: {
      charIndex: Number(event.charIndex || 0),
      elapsedTime: Number(event.elapsedTime || 0),
      name: event.name || "word",
    },
  }));
  utterance.onend = () => window.dispatchEvent(new CustomEvent("boxing-voice-end"));
  utterance.onerror = () => window.dispatchEvent(new CustomEvent("boxing-voice-end"));
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function speakFeedback(text) {
  const now = Date.now();
  if (now - state.lastFeedbackAt < state.settings.feedbackCooldownSeconds * 1000) return;
  state.lastFeedbackAt = now;
  speakText(localizedFeedbackText(text));
}

function voiceLanguage() {
  return state.settings.voiceLanguage === "en-US" ? "en-US" : "ko-KR";
}

function preferredVoice(language) {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang === language)
    || voices.find((voice) => voice.lang?.startsWith(language.slice(0, 2)))
    || null;
}

function voiceLine(ko, en) {
  return voiceLanguage() === "en-US" ? en : ko;
}

function playTone(frequency = 540) {
  if (!state.settings.sound) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.24);
}
