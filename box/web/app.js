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
  sessionBusy: false,
  pendingSessionStart: null,
  cameraMessage: "",
  usernameChecked: "",
  selectedMemberId: "",
  selectedRecordIds: new Set(),
  activeSessionId: "",
  activeSessionStartedAt: 0,
  sessionTimer: null,
  roundTimer: null,
  recorder: null,
  recordedChunks: [],
  recordingStream: null,
  localRecordings: {},
  sessionCameraSources: [],
  settings: loadSettings(),
  settingsMessage: "",
  center: loadCenterProfile(),
  centerMessage: "",
  accountModalOpen: false,
  cameraSetup: loadCameraSetup(),
  videoDevices: [],
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
    $("#sessionMessage").textContent = error.message;
  }
});

$("#retryCamera").addEventListener("click", async () => {
  await previewCamera();
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
