const state = {
  token: null,
  refreshToken: null,
  tokenExpiresAt: 0,
  user: null,
  profile: null,
  members: [],
  sessions: [],
  accounts: [],
  accountsMessage: "",
  showAccountCreateForm: false,
  platformCenters: [],
  platformAuditLogs: [],
  platformFeatureFlags: [],
  selectedPlatformCenterId: "",
  platformCenterSearch: "",
  platformMessage: "",
  showPlatformCenterCreateForm: false,
  publicCenterSignup: true,
  activeView: "coach",
  authMode: "owner",
  sidebarCollapsed: localStorage.getItem("sidebar_collapsed") === "true",
  latestPose: null,
  cameraReady: false,
  usernameChecked: "",
  memberFilter: "all",
  memberSearch: "",
  showMemberForm: false,
  editingMemberId: "",
  selectedMemberId: "",
  selectedRecordIds: new Set(),
  activeSessionId: "",
  activeSessionStartedAt: 0,
  sessionTimer: null,
  roundTimer: null,
  recorder: null,
  recordedChunks: [],
  recordingStream: null,
  recordingCanvas: null,
  recordingFrame: null,
  localRecordings: {},
  poseRuntime: null,
  poseLandmarker: null,
  poseLandmarkers: [],
  poseLoop: null,
  poseRunning: false,
  lastVideoTime: -1,
  poseTimestampMs: 0,
  poseTimestampOriginMs: 0,
  poseErrorShown: false,
  sessionCameraSources: [],
  pose3dInFlight: false,
  lastPose3dAt: 0,
  lastPose3dPacketAt: 0,
  pose3dStatus: "",
  feedbackLog: [],
  lastFeedbackAt: 0,
  feedbackWindow: null,
  sessionFeedback: null,
  currentInstruction: null,
  currentInstructionProgress: 0,
  currentInstructionStartedAt: 0,
  currentInstructionQuality: {},
  lastMotionSample: null,
  motionHistory: [],
  cameraMotionHistories: {},
  lastCameraMotionSamples: {},
  punchLock: null,
  settings: loadSettings(),
  settingsMessage: "",
  center: loadCenterProfile(),
  centerMessage: "",
  staff: loadStaff(),
  selectedStaffId: "",
  showStaffForm: false,
  staffMessage: "",
  accountModalOpen: false,
  cameraSetup: loadCameraSetup(),
  memberCalibrations: loadMemberCalibrations(),
  calibrationMessage: "",
  calibrationRunning: false,
  calibrationCancelled: false,
  videoDevices: [],
  activeCameraConfig: [],
};

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.authMode = tab.dataset.authMode;
    renderAuthForm();
  });
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $("#authMessage").textContent = "";
  try {
    if (state.authMode === "signup") {
      await signup(form);
    } else {
      await login(form.get("username"), form.get("password"));
    }
  } catch (error) {
    $("#authMessage").textContent = error.message;
  }
});

$("#logoutButton").addEventListener("click", logout);

$("#sidebarToggle").addEventListener("click", () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("sidebar_collapsed", String(state.sidebarCollapsed));
  renderApp();
});

$("#startSession").addEventListener("click", async () => {
  state.activeView = "coach";
  renderApp();
  await startSession();
});

$("#startSessionHud").addEventListener("click", startSession);

$("#stopSessionHud").addEventListener("click", async () => {
  try {
    await stopSession();
  } catch (error) {
    $("#feedbackText").textContent = error.message;
  }
});

$("#retryCamera").addEventListener("click", async () => {
  await startSession();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  drawSkeleton();
});

applyTheme();
initializeApplication();

async function initializeApplication() {
  try {
    const response = await platformApiFetch("/system/health");
    const capabilities = await response.json();
    if (typeof capabilities.public_center_signup === "boolean") {
      state.publicCenterSignup = capabilities.public_center_signup;
    }
  } catch (error) {
    console.warn("서버 기능 정보를 확인하지 못했습니다.", error);
  }
  try {
    const session = await authSessionStorage.load();
    state.token = session?.token || null;
    state.refreshToken = session?.refreshToken || null;
    state.tokenExpiresAt = Number(session?.expiresAt || 0);
  } catch (error) {
    console.warn("보안 로그인 정보를 불러오지 못했습니다.", error);
  }
  await hydrate();
}
