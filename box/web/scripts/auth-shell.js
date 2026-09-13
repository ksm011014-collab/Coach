async function api(path, options = {}, allowRefresh = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await platformApiFetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && allowRefresh && state.refreshToken && !path.startsWith("/auth/")) {
    await refreshAuthSession();
    return api(path, options, false);
  }
  if (!response.ok) throw new Error(payload.error || localizedApiError(response.status));
  return payload;
}

async function refreshAuthSession() {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) {
    await clearAuthSession();
    throw new Error(payload.error || "로그인이 만료되었습니다. 다시 로그인해주세요.");
  }
  await applyAuthSession(payload);
}

async function applyAuthSession(payload) {
  state.token = payload.token;
  state.refreshToken = payload.refresh_token || state.refreshToken || null;
  state.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  await authSessionStorage.save({
    token: state.token,
    refreshToken: state.refreshToken || "",
    expiresAt: state.tokenExpiresAt,
  });
}

async function clearAuthSession() {
  state.token = null;
  state.refreshToken = null;
  state.tokenExpiresAt = 0;
  await authSessionStorage.clear();
}

function localizedApiError(status) {
  if (status === 401) return "로그인이 필요합니다.";
  if (status === 403) return "이 작업을 수행할 권한이 없습니다.";
  if (status === 503) return "중앙 서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.";
  return "요청을 처리하지 못했습니다.";
}

async function login(username, password) {
  const payload = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  await applyAuthSession(payload);
  await hydrate();
}

async function signup(form) {
  const body = Object.fromEntries(form.entries());
  body.role = body.signup_role || "MEMBER";
  delete body.signup_role;
  body.username = normalizeUsername(body.username);
  body.center_code = normalizeCenterCode(body.center_code);
  if (state.usernameChecked !== body.username) {
    throw new Error("아이디 중복 확인을 먼저 해주세요.");
  }
  if (body.role === "OWNER" && !String(body.center_name || "").trim()) {
    throw new Error("관리자 가입은 센터명이 필요합니다.");
  }
  if (body.role === "MEMBER" && !body.center_code) {
    throw new Error("회원 가입은 센터 코드가 필요합니다.");
  }
  if (body.password !== body.password_confirm) {
    throw new Error("비밀번호 확인이 일치하지 않습니다.");
  }
  if (!isValidPassword(body.password)) {
    throw new Error("비밀번호는 특수문자를 포함해 8자리 이상이어야 합니다.");
  }
  const payload = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await applyAuthSession(payload);
  await hydrate();
}

async function hydrate() {
  if (!state.token) return renderLoggedOut();
  try {
    const me = await api("/me");
    state.user = me.user;
    state.profile = me.profile;
    syncCenterFromAccount();
    const members = await api("/members");
    const sessions = await api("/sessions");
    state.members = members.members;
    state.sessions = sessions.sessions;
    state.accounts = [];
    if (roleCanManageAccounts(state.user.role)) {
      const accounts = await api("/admin/accounts");
      state.accounts = accounts.accounts;
    }
    if (state.user.role === "PLATFORM_ADMIN") {
      const [centers, auditLogs] = await Promise.all([
        api("/admin/centers"),
        api("/admin/audit-logs?limit=100"),
      ]);
      state.platformCenters = centers.centers || [];
      state.platformAuditLogs = auditLogs.audit_logs || [];
      if (!state.selectedPlatformCenterId && state.platformCenters.length) {
        state.selectedPlatformCenterId = state.platformCenters[0].id;
      }
      if (state.selectedPlatformCenterId) {
        const flags = await api(`/admin/centers/${state.selectedPlatformCenterId}/features`);
        state.platformFeatureFlags = flags.feature_flags || [];
      }
    }
    state.localRecordings = await loadLocalRecordings();
    renderApp();
  } catch (error) {
    console.warn(error);
    await clearAuthSession();
    renderLoggedOut();
  }
}

function renderLoggedOut() {
  $("#app").className = "shell auth-shell";
  $("#sidebar").classList.add("hidden");
  $("#loginPanel").classList.remove("hidden");
  $("#hud").classList.add("hidden");
  $("#workspace").classList.add("hidden");
  $("#nav").innerHTML = "";
  renderAuthForm();
}

function renderApp() {
  normalizeActiveView();
  $("#app").className = `shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}`;
  $("#sidebar").classList.remove("hidden");
  $("#loginPanel").classList.add("hidden");
  $("#workspace").classList.toggle("hidden", state.activeView === "coach");
  $("#hud").classList.toggle("hidden", state.activeView !== "coach");
  $("#userName").textContent = `${state.user.name} · ${roleLabel(state.user.role)}`;
  $("#sidebarToggle").title = state.sidebarCollapsed ? "사이드바 열기" : "사이드바 접기";
  renderNav();
  renderView();
  resizeCanvas();
  resetHud();
  if (state.activeView === "coach") {
    drawSkeleton();
  }
}

function renderAuthForm() {
  const config = authDefaults[state.authMode];
  state.usernameChecked = "";
  document.querySelector(".auth-card").classList.toggle("signup-mode", state.authMode === "signup");
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === state.authMode);
  });
  document.querySelector(".auth-tabs").classList.toggle("hidden", state.authMode === "signup");
  const extras =
    state.authMode === "signup"
      ? ""
      : `<label class="remember-row"><input type="checkbox" name="remember" /> <span>아이디 저장</span></label>`;
  const links =
    state.authMode === "signup"
      ? `<div class="signup-actions"><button id="authSubmit">${config.button}</button><button type="button" class="back-button" data-auth-link="member">뒤로가기</button></div>`
      : `<div class="auth-links"><button type="button" class="link-button" data-auth-link="signup">센터/회원 가입하기</button><span></span><button type="button" class="link-button">비밀번호 찾기</button></div>`;
  $("#loginForm").innerHTML = [
    ...config.fields.map(renderField),
    extras,
    state.authMode === "signup" ? "" : `<button id="authSubmit">${config.button}</button>`,
    links,
    `<p id="authMessage" class="form-message"></p>`,
  ].join("");
  document.querySelectorAll("[data-auth-link]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authLink;
      renderAuthForm();
    });
  });
  const checkButton = $("#checkUsernameButton");
  if (checkButton) {
    checkButton.addEventListener("click", checkUsername);
  }
  setupSignupRoleFields();
}

function renderField(field) {
  const roleAttrs = field.signupRole ? ` data-signup-role="${field.signupRole}"` : "";
  if (field.type === "select") {
    const options = field.name === "signup_role" && !state.publicCenterSignup
      ? field.options.filter(([value]) => value !== "OWNER")
      : field.options;
    return `<select name="${field.name}"${roleAttrs} required>${options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("")}</select>`;
  }
  const input = `<input name="${field.name}" value="${field.value}" type="${field.type}" placeholder="${field.placeholder}" autocomplete="off"${roleAttrs} required />`;
  if (!field.withCheck) return input;
  return `<div class="username-row">${input}<button type="button" id="checkUsernameButton">중복 확인</button></div>`;
}

function roleLabel(role) {
  return {
    PLATFORM_ADMIN: "플랫폼 관리자",
    CENTER_OWNER: "센터 관리자",
    COACH: "코치",
    OWNER: "관리자",
    MEMBER: "회원",
  }[role] || role;
}

function syncCenterFromAccount() {
  if (!state.user?.center_name) return;
  state.center = {
    ...state.center,
    name: state.user.center_name,
    owner: ["OWNER", "CENTER_OWNER"].includes(state.user.role) ? state.user.name : state.center.owner,
    code: state.user.center_code || state.center.code,
  };
  saveCenterProfile();
}

function setupSignupRoleFields() {
  const roleSelect = document.querySelector('select[name="signup_role"]');
  if (!roleSelect) return;
  const syncFields = () => {
    document.querySelectorAll("[data-signup-role]").forEach((field) => {
      const active = field.dataset.signupRole === roleSelect.value;
      field.classList.toggle("hidden", !active);
      field.disabled = !active;
      field.required = active;
    });
  };
  roleSelect.addEventListener("change", syncFields);
  syncFields();
}

async function checkUsername() {
  const input = document.querySelector('input[name="username"]');
  const username = normalizeUsername(input.value);
  $("#authMessage").textContent = "";
  if (!/^[a-z0-9_]{4,20}$/.test(username)) {
    $("#authMessage").textContent = "아이디는 영문 소문자, 숫자, _ 조합 4-20자리입니다.";
    return;
  }
  const result = await api(`/auth/check-username?username=${encodeURIComponent(username)}`);
  if (!result.available) {
    state.usernameChecked = "";
    $("#authMessage").textContent = "이미 사용 중인 아이디입니다.";
    return;
  }
  state.usernameChecked = username;
  input.value = username;
  $("#authMessage").textContent = "사용 가능한 아이디입니다.";
}

function renderNav() {
  const visible = navigationForRole(state.user.role);
  $("#nav").innerHTML = visible
    .map(([key, label]) => `<button class="nav-item ${state.activeView === key ? "active" : ""}" data-view="${key}" title="${label}">${svgIcon(navIcons[key])}<span class="nav-label">${label}</span></button>`)
    .join("");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderApp();
      if (state.activeView === "coach") resetHud();
    });
  });
}

function normalizeActiveView() {
  const allowed = new Set(navigationForRole(state.user?.role).map(([key]) => key));
  if (!allowed.has(state.activeView)) {
    state.activeView = state.user?.role === "MEMBER"
      ? "memberWorkouts"
      : state.user?.role === "PLATFORM_ADMIN"
        ? "platformOps"
        : "dashboard";
  }
}

function renderView() {
  const titleMap = {
    platformOps: "중앙 관제",
    dashboard: "대시보드",
    center: "센터 정보",
    members: "회원 관리",
    staff: "직원",
    accounts: "계정 권한",
    attendance: "출석",
    memberWorkouts: "운동 현황",
    memberAttendance: "출석",
    memberProfile: "정보 변경",
    settings: "설정",
  };
  $("#viewTitle").textContent = titleMap[state.activeView] || "대시보드";
  if (state.activeView === "platformOps") renderPlatformOperations();
  if (state.activeView === "dashboard") renderDashboard();
  if (state.activeView === "center") renderCenterInfo();
  if (state.activeView === "members") renderMembers();
  if (state.activeView === "staff") renderStaff();
  if (state.activeView === "accounts") renderAccounts();
  if (state.activeView === "attendance") renderAttendance();
  if (state.activeView === "memberWorkouts") renderMemberWorkouts();
  if (state.activeView === "memberAttendance") renderMemberAttendance();
  if (state.activeView === "memberProfile") renderMemberProfile();
  if (state.activeView === "settings") renderSettings();
}
