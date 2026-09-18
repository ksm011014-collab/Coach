function defaultSettings() {
  return {
    theme: "dark",
    notifications: false,
    sound: true,
  };
}

function loadSettings() {
  const saved = readJsonStorage(SETTINGS_KEY, {});
  return Object.fromEntries(Object.entries(defaultSettings()).map(([key, value]) => [key, saved[key] ?? value]));
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

        enabled: true,
        device_id: "",

      },
      {
        camera_id: "cam_side_01",
        label: "측면",
        view_angle: "side_90",

        enabled: false,
        device_id: "",

      },
      {
        camera_id: "cam_rear_45_01",
        label: "후면 45도",
        view_angle: "rear_45",

        enabled: false,
        device_id: "",

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
    const camera = Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, incoming[key] ?? value]));
    camera.enabled = index < targetCount;
    camera.device_id = String(camera.device_id || "");
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

function activeCameraConfig() {
  return normalizeCameraSetup(state.cameraSetup).cameras
    .filter((camera) => camera.enabled)
    .map((camera) => ({
      camera_id: camera.camera_id,
      label: camera.label,
      view_angle: camera.view_angle,

      enabled: true,
      device_id: camera.device_id || "",

    }));
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
  return `
      <article class="admin-board settings-panel camera-rig-panel">
        <div class="settings-heading">
          <small>카메라 구성</small>
          <h3>카메라 설정</h3><p>미리보기와 녹화에 사용할 장치를 선택합니다.</p>
        </div>
        <div class="segmented camera-count-segment">
          ${[1, 2, 3].map((count) => `<button class="${setup.targetCount === count ? "active" : ""}" data-camera-count="${count}">${count}대</button>`).join("")}
        </div>
        <div class="camera-grid">
          ${setup.cameras.map((camera, index) => renderCameraConfigRow(camera, index, setup.targetCount)).join("")}
        </div>
        <button id="scanCameraDevices" class="ghost">카메라 검색</button>
        <p class="form-message">${escapeHtml(state.cameraMessage)}</p>
      </article>`;
}

function renderCameraConfigRow(camera, index, targetCount) {
  const disabled = index >= targetCount;
  return `
    <div class="camera-config-row ${disabled ? "disabled" : ""}">
      <div class="camera-config-title">
        <span>${escapeHtml(cameraDisplayLabel(camera))}</span>
        <strong>${disabled ? "사용 안 함" : "사용"}</strong>
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
      state.cameraMessage = "카메라 대수가 변경되었습니다.";
      saveCameraSetup();
      renderSettings();
    });
  });
  document.querySelectorAll("[data-camera-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.cameraIndex);
      const field = input.dataset.cameraField;
      state.cameraSetup.cameras[index][field] = input.value;
      state.cameraMessage = "카메라 설정을 저장했습니다.";
      saveCameraSetup();
      renderSettings();
    });
  });
  $("#scanCameraDevices")?.addEventListener("click", refreshVideoDevices);
}

async function refreshVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.cameraMessage = "이 브라우저에서는 카메라 목록을 확인할 수 없습니다.";
    renderSettings();
    return;
  }
  let permissionStream;
  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.videoDevices = await enumerateVideoDevices();
    state.cameraMessage = `카메라 ${state.videoDevices.length}대를 찾았습니다.`;
  } catch (error) {
    state.cameraMessage = `카메라 목록 확인 실패: ${error.message}`;
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop());
  }
  renderSettings();
}

async function enumerateVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
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
          <h3>알림</h3>
          <p>세션 종료 알림과 시작·종료 신호음을 설정합니다.</p>
        </div>
        <label class="setting-row">
          <span><strong>세션 알림</strong><small>${notificationState}</small></span>
          <input type="checkbox" data-setting-toggle="notifications" ${state.settings.notifications ? "checked" : ""} />
        </label>

        <label class="setting-row">
          <span><strong>효과음</strong><small>세션 시작/종료 신호음</small></span>
          <input type="checkbox" data-setting-toggle="sound" ${state.settings.sound ? "checked" : ""} />
        </label>
        <div class="settings-actions">
          <button id="requestNotifications">알림 권한 요청</button>
          <button id="testSound">효과음 테스트</button>
        </div>
      </article>

      ${renderCameraRigSettings()}

      <article class="admin-board settings-panel">
        <div class="settings-heading">
          <small>Account</small>
          <h3>계정 설정</h3>
          <p>${escapeHtml(state.user.username)} · ${roleLabel(state.user.role)} · ${escapeHtml(state.user.center_name || state.center.name)}</p>
        </div>
        <div class="account-summary">
          <span>현재 계정</span>
          <strong>${escapeHtml(state.profile?.name || state.user.name || "")}</strong>
          <button id="editAccountInfo" class="ghost small-button">정보 수정</button>
        </div>
      </article>

      <p><a href="/preview.html" target="_blank" rel="noopener">개발용 관리 화면 미리보기</a> · 합성 데이터만 사용하는 별도 화면입니다.</p>
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
  oscillator.onended = () => audio.close();
}
