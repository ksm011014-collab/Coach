const SETTINGS_KEY = "boxing_settings";
const CENTER_KEY = "boxing_center_profile";
const STAFF_KEY = "boxing_staff";

const state = {
  token: localStorage.getItem("boxing_token"),
  user: null,
  profile: null,
  members: [],
  sessions: [],
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
  poseLandmarker: null,
  poseLoop: null,
  poseRunning: false,
  lastVideoTime: -1,
  poseTimestampMs: 0,
  poseErrorShown: false,
  feedbackLog: [],
  lastFeedbackAt: 0,
  feedbackWindow: null,
  sessionFeedback: null,
  lastMotionSample: null,
  motionHistory: [],
  settings: loadSettings(),
  settingsMessage: "",
  center: loadCenterProfile(),
  centerMessage: "",
  staff: loadStaff(),
  selectedStaffId: "",
  showStaffForm: false,
  staffMessage: "",
  accountModalOpen: false,
};

const FEEDBACK_WINDOW_MS = 5000;
const MOTION_EVENT_COOLDOWN_MS = 700;
const ACTION_TYPES = [
  ["jab", "잽"],
  ["right", "라이트"],
  ["oneTwo", "원투"],
  ["hook", "훅"],
  ["upper", "어퍼"],
  ["duck", "더킹"],
  ["weave", "위빙"],
];

const navItems = [
  ["coach", "실시간 코칭"],
  ["dashboard", "대시보드"],
  ["center", "센터 정보"],
  ["members", "회원 관리"],
  ["staff", "직원"],
  ["attendance", "출석"],
  ["settings", "설정"],
];

const memberNavItems = [
  ["coach", "실시간 코칭"],
  ["memberWorkouts", "운동 현황"],
  ["memberAttendance", "출석"],
  ["memberProfile", "정보 변경"],
  ["settings", "설정"],
];

const navIcons = {
  coach: "video",
  dashboard: "chartPie",
  center: "home",
  members: "user",
  staff: "idCard",
  attendance: "calendar",
  memberWorkouts: "activity",
  memberAttendance: "calendar",
  memberProfile: "user",
  settings: "settings",
};

const iconPaths = {
  activity: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>`,
  chartPie: `<path d="M21 12c.6 0 1-.4.9-1a10 10 0 0 0-8.9-8.9c-.6-.1-1 .4-1 .9v8a1 1 0 0 0 1 1z"/><path d="M21.2 15.9A10 10 0 1 1 8 2.8"/>`,
  home: `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v11h14V10"/>`,
  idCard: `<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="3" y="4" width="18" height="16" rx="2"/>`,
  power: `<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>`,
  settings: `<path d="M9.7 3.4a1 1 0 0 1 1-.7h2.6a1 1 0 0 1 1 .7l.4 1.4a1 1 0 0 0 1.4.6l1.3-.6a1 1 0 0 1 1.2.2l1.8 1.8a1 1 0 0 1 .2 1.2l-.6 1.3a1 1 0 0 0 .6 1.4l1.4.4a1 1 0 0 1 .7 1v2.6a1 1 0 0 1-.7 1l-1.4.4a1 1 0 0 0-.6 1.4l.6 1.3a1 1 0 0 1-.2 1.2l-1.8 1.8a1 1 0 0 1-1.2.2l-1.3-.6a1 1 0 0 0-1.4.6l-.4 1.4a1 1 0 0 1-1 .7h-2.6a1 1 0 0 1-1-.7l-.4-1.4a1 1 0 0 0-1.4-.6l-1.3.6a1 1 0 0 1-1.2-.2l-1.8-1.8a1 1 0 0 1-.2-1.2l.6-1.3a1 1 0 0 0-.6-1.4l-1.4-.4a1 1 0 0 1-.7-1v-2.6a1 1 0 0 1 .7-1l1.4-.4a1 1 0 0 0 .6-1.4L3.4 8a1 1 0 0 1 .2-1.2L5.4 5a1 1 0 0 1 1.2-.2l1.3.6a1 1 0 0 0 1.4-.6z"/><circle cx="12" cy="12" r="3"/>`,
  user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  video: `<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>`,
};

function svgIcon(name, className = "nav-icon") {
  const paths = iconPaths[name] || iconPaths.activity;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const authDefaults = {
  owner: {
    button: "로그인",
    fields: [
      { name: "username", value: "owner", placeholder: "아이디를 입력하세요.", type: "text" },
      { name: "password", value: "Owner!123", placeholder: "비밀번호를 입력하세요.", type: "password" },
    ],
  },
  member: {
    button: "로그인",
    fields: [
      { name: "username", value: "member", placeholder: "아이디를 입력하세요.", type: "text" },
      { name: "password", value: "Member!123", placeholder: "비밀번호를 입력하세요.", type: "password" },
    ],
  },
  signup: {
    button: "가입하기",
    fields: [
      {
        name: "signup_role",
        value: "OWNER",
        placeholder: "가입 유형",
        type: "select",
        options: [
          ["OWNER", "관리자: 새 센터 생성"],
          ["MEMBER", "회원: 센터 코드로 가입"],
        ],
      },
      { name: "center_name", value: "", placeholder: "센터명", type: "text", signupRole: "OWNER" },
      { name: "center_code", value: "", placeholder: "센터 코드", type: "text", signupRole: "MEMBER" },
      { name: "username", value: "", placeholder: "아이디", type: "text", withCheck: true },
      { name: "name", value: "", placeholder: "관리자/회원 이름", type: "text" },
      { name: "email", value: "", placeholder: "이메일", type: "email" },
      { name: "password", value: "", placeholder: "비밀번호: 특수문자 포함 8자리 이상", type: "password" },
      { name: "password_confirm", value: "", placeholder: "비밀번호 확인", type: "password" },
      { name: "phone", value: "", placeholder: "전화번호", type: "tel" },
      { name: "birthdate", value: "", placeholder: "생년월일", type: "date" },
      {
        name: "gender",
        value: "",
        placeholder: "성별",
        type: "select",
        options: [
          ["", "성별 선택"],
          ["male", "남성"],
          ["female", "여성"],
          ["other", "기타"],
        ],
      },
    ],
  },
};

const $ = (selector) => document.querySelector(selector);
const MEDIAPIPE_TASKS_VERSION = "0.10.35";
const MEDIAPIPE_TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}`;

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "request failed");
  return payload;
}

async function login(username, password) {
  const payload = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  state.token = payload.token;
  localStorage.setItem("boxing_token", state.token);
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
  state.token = payload.token;
  localStorage.setItem("boxing_token", state.token);
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
    state.localRecordings = await loadLocalRecordings();
    renderApp();
  } catch (error) {
    console.warn(error);
    localStorage.removeItem("boxing_token");
    state.token = null;
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
    return `<select name="${field.name}"${roleAttrs} required>${field.options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("")}</select>`;
  }
  const input = `<input name="${field.name}" value="${field.value}" type="${field.type}" placeholder="${field.placeholder}" autocomplete="off"${roleAttrs} required />`;
  if (!field.withCheck) return input;
  return `<div class="username-row">${input}<button type="button" id="checkUsernameButton">중복 확인</button></div>`;
}

function roleLabel(role) {
  return role === "OWNER" ? "관리자" : "회원";
}

function syncCenterFromAccount() {
  if (!state.user?.center_name) return;
  state.center = {
    ...state.center,
    name: state.user.center_name,
    owner: state.user.role === "OWNER" ? state.user.name : state.center.owner,
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
  const visible = state.user.role === "OWNER" ? navItems : memberNavItems;
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
  const allowed = new Set((state.user?.role === "OWNER" ? navItems : memberNavItems).map(([key]) => key));
  if (!allowed.has(state.activeView)) {
    state.activeView = state.user?.role === "OWNER" ? "dashboard" : "memberWorkouts";
  }
}

function renderView() {
  const titleMap = {
    dashboard: "대시보드",
    center: "센터 정보",
    members: "회원 관리",
    staff: "직원",
    attendance: "출석",
    memberWorkouts: "운동 현황",
    memberAttendance: "출석",
    memberProfile: "정보 변경",
    settings: "설정",
  };
  $("#viewTitle").textContent = titleMap[state.activeView] || "대시보드";
  if (state.activeView === "dashboard") renderDashboard();
  if (state.activeView === "center") renderCenterInfo();
  if (state.activeView === "members") renderMembers();
  if (state.activeView === "staff") renderStaff();
  if (state.activeView === "attendance") renderAttendance();
  if (state.activeView === "memberWorkouts") renderMemberWorkouts();
  if (state.activeView === "memberAttendance") renderMemberAttendance();
  if (state.activeView === "memberProfile") renderMemberProfile();
  if (state.activeView === "settings") renderSettings();
}

function memberSessions() {
  return state.sessions
    .filter((session) => session.user_id === state.user?.id)
    .sort((a, b) => b.started_at - a.started_at);
}

function renderMemberWorkouts() {
  const sessions = memberSessions();
  const finished = sessions.filter((session) => session.ended_at);
  const scored = finished.filter((session) => Number(session.overall_score) > 0);
  const averageScore = scored.length
    ? Math.round(scored.reduce((total, session) => total + Number(session.overall_score || 0), 0) / scored.length)
    : 0;
  const bestScore = scored.length ? Math.max(...scored.map((session) => Number(session.overall_score || 0))) : 0;
  const totalMinutes = Math.round(finished.reduce((total, session) => total + Math.max(0, (session.ended_at || session.started_at) - session.started_at), 0) / 60);
  const latest = sessions[0];
  const rows = sessions.slice(0, 8).map((session) => `
    <tr>
      <td>${formatDateTime(session.started_at)}</td>
      <td>${session.ended_at ? formatDuration(session.started_at, session.ended_at) : "진행 중"}</td>
      <td>${session.focus || "guard_and_strikes"}</td>
      <td><strong>${session.overall_score || 0}</strong></td>
      <td>${state.localRecordings[session.id] ? `<button class="ghost small-button" data-recording-id="${session.id}">녹화 보기</button>` : "-"}</td>
    </tr>`).join("");
  $("#viewContent").innerHTML = `
    <section class="member-page">
      <div class="dashboard-kpis">
        ${dashboardMetric("총 운동", `${sessions.length}회`, "내 세션 기록")}
        ${dashboardMetric("평균 점수", `${averageScore}점`, "완료 세션 기준")}
        ${dashboardMetric("최고 점수", `${bestScore}점`, "개인 최고 기록")}
        ${dashboardMetric("누적 시간", `${totalMinutes}분`, "완료 세션 합계")}
      </div>
      <section class="member-summary-grid">
        <article class="admin-board member-highlight">
          <div class="dashboard-section-head">
            <div>
              <small>Latest</small>
              <h3>최근 운동</h3>
            </div>
            <button id="memberStartSession">실시간 코칭 시작</button>
          </div>
          ${latest ? `
            <div class="latest-workout">
              <strong>${latest.overall_score || 0}점</strong>
              <span>${formatDateTime(latest.started_at)}</span>
              <p>${latest.ended_at ? formatDuration(latest.started_at, latest.ended_at) : "진행 중"} · ${latest.focus || "기본 코칭"}</p>
            </div>` : `<p class="empty-note">아직 운동 기록이 없습니다.</p>`}
        </article>
        <article class="admin-board">
          <div class="dashboard-section-head">
            <div>
              <small>Goal</small>
              <h3>이번 주 목표</h3>
            </div>
          </div>
          <div class="member-goals">
            ${attentionItem("운동 횟수", `${Math.min(sessionsThisWeek(sessions), 3)}/3`, "주 3회 목표")}
            ${attentionItem("가드 복귀", averageScore >= 75 ? "양호" : "집중", "점수 75점 이상 유지")}
          </div>
        </article>
      </section>
      <article class="admin-board">
        <div class="dashboard-section-head">
          <div>
            <small>History</small>
            <h3>운동 기록</h3>
          </div>
        </div>
        <div class="table-wrap">
          <table class="admin-table member-workout-table">
            <thead><tr><th>날짜</th><th>시간</th><th>목표</th><th>점수</th><th>녹화</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5">운동 기록이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </article>
    </section>`;
  $("#memberStartSession").addEventListener("click", async () => {
    state.activeView = "coach";
    renderApp();
    await startSession();
  });
  document.querySelectorAll("[data-recording-id]").forEach((button) => {
    button.addEventListener("click", () => playRecording(button.dataset.recordingId));
  });
}

function sessionsThisWeek(sessions) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const startSeconds = start.getTime() / 1000;
  return sessions.filter((session) => session.started_at >= startSeconds).length;
}

function renderMemberAttendance(selectedDay = new Date().getDate()) {
  const sessions = memberSessions();
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const byDay = {};
  sessions.forEach((session) => {
    const date = new Date(session.started_at * 1000);
    if (date.getFullYear() === year && date.getMonth() === month) {
      const day = date.getDate();
      byDay[day] = byDay[day] || [];
      byDay[day].push(session);
    }
  });
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(`<button class="calendar-day empty"></button>`);
  for (let day = 1; day <= lastDay; day++) {
    const count = (byDay[day] || []).length;
    const weekendClass = dayOfWeekClass(year, month, day);
    cells.push(`<button class="calendar-day member-attendance-day ${weekendClass} ${day === selectedDay ? "selected" : ""} ${count ? "has-session" : ""}" data-day="${day}">
      <strong>${day}</strong><span>${count ? `${count}회 운동` : "기록 없음"}</span>
    </button>`);
  }
  const selected = byDay[selectedDay] || [];
  $("#viewContent").innerHTML = `
    <section class="attendance-layout member-attendance-layout">
      <div class="admin-board">
        <div class="calendar-head">
          <strong>${year}.${String(month + 1).padStart(2, "0")}</strong>
          <span>내 출석 캘린더</span>
        </div>
        <div class="calendar-week"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
        <div class="attendance-calendar">${cells.join("")}</div>
      </div>
      <aside class="admin-board attendance-detail">
        <small>${month + 1}월 ${selectedDay}일</small>
        <h3>${selected.length}회 운동</h3>
        <div>${selected.map((session) => `<p><span class="badge">${session.overall_score || 0}점</span>${formatDuration(session.started_at, session.ended_at || session.started_at)}</p>`).join("") || "<p>운동 기록 없음</p>"}</div>
      </aside>
    </section>`;
  document.querySelectorAll(".calendar-day[data-day]").forEach((button) => {
    button.addEventListener("click", () => renderMemberAttendance(Number(button.dataset.day)));
  });
}

function renderMemberProfile() {
  const profile = state.profile || {};
  $("#viewContent").innerHTML = `
    <section class="member-profile-layout">
      <article class="admin-board member-profile-card">
        <div class="staff-profile">
          <span class="avatar large-avatar">${(profile.name || state.user.name || "회").slice(0, 1)}</span>
          <div>
            <small>Member Profile</small>
            <h3>${escapeHtml(profile.name || state.user.name || "")}</h3>
            <p>${state.user.username} · ${state.user.email || "이메일 없음"}</p>
          </div>
        </div>
      </article>
      <article class="admin-board">
        <div class="dashboard-section-head">
          <div>
            <small>Edit</small>
            <h3>정보 변경</h3>
          </div>
        </div>
        <form id="memberProfileForm" class="member-profile-form">
          ${memberProfileInput("name", "이름", profile.name || state.user.name || "")}
          ${memberProfileInput("phone", "전화번호", profile.phone || "")}
          ${memberProfileInput("birthdate", "생년월일", profile.birthdate || "", "date")}
          <label class="center-field"><span>성별</span><select name="gender">
            ${profileOption("", "선택 안함", profile.gender)}
            ${profileOption("male", "남성", profile.gender)}
            ${profileOption("female", "여성", profile.gender)}
            ${profileOption("other", "기타", profile.gender)}
          </select></label>
          ${memberProfileInput("height_cm", "키(cm)", profile.height_cm || "", "number")}
          ${memberProfileInput("weight_kg", "몸무게(kg)", profile.weight_kg || "", "number")}
          ${memberProfileInput("reach_cm", "리치(cm)", profile.reach_cm || "", "number")}
          <label class="center-field"><span>스탠스</span><select name="stance">
            ${profileOption("", "선택 안함", profile.stance)}
            ${profileOption("orthodox", "오소독스", profile.stance)}
            ${profileOption("southpaw", "사우스포", profile.stance)}
          </select></label>
          <label class="center-field full"><span>부상/주의 사항</span><textarea name="injury_note">${escapeHtml(profile.injury_note || "")}</textarea></label>
          <div class="member-profile-actions">
            <button>정보 저장</button>
            <button type="button" class="ghost" id="refreshMemberProfile">새로고침</button>
          </div>
          <p id="memberProfileMessage" class="form-message"></p>
        </form>
      </article>
    </section>`;
  $("#memberProfileForm").addEventListener("submit", saveMemberProfile);
  $("#refreshMemberProfile").addEventListener("click", refreshMemberProfile);
}

function memberProfileInput(name, label, value, type = "text") {
  return `<label class="center-field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" /></label>`;
}

function profileOption(value, label, selected) {
  return `<option value="${value}" ${String(selected || "") === value ? "selected" : ""}>${label}</option>`;
}

async function saveMemberProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  ["height_cm", "weight_kg", "reach_cm"].forEach((key) => {
    body[key] = body[key] ? Number(body[key]) : 0;
  });
  try {
    const result = await api(`/members/${state.profile.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    state.profile = result.member;
    state.user.name = result.member.name || state.user.name;
    $("#memberProfileMessage").textContent = "정보를 저장했습니다.";
    $("#userName").textContent = `${state.user.name} · 회원`;
  } catch (error) {
    $("#memberProfileMessage").textContent = error.message;
  }
}

async function refreshMemberProfile() {
  const me = await api("/me");
  state.user = me.user;
  state.profile = me.profile;
  renderMemberProfile();
}

function renderDashboard() {
  const summary = dashboardSummary();
  const memberStatus = dashboardMemberStatus();
  const totalMembers = Math.max(memberStatus.total, 1);
  const activeDeg = (memberStatus.attended / totalMembers) * 360;
  const idleDeg = activeDeg + (memberStatus.idle / totalMembers) * 360;
  const recentRows = recentDashboardSessions().map(({ session, member }) => `
    <tr>
      <td>${member?.name || "미지정"}</td>
      <td>${formatDateTime(session.started_at)}</td>
      <td>${session.ended_at ? formatDuration(session.started_at, session.ended_at) : "진행 중"}</td>
      <td><strong>${session.overall_score || 0}</strong></td>
    </tr>`).join("");
  $("#viewContent").innerHTML = `
    <section class="dashboard-layout">
      <div class="dashboard-kpis">
        ${dashboardMetric("오늘 세션", `${summary.todaySessions}건`, "오늘 시작된 운동")}
        ${dashboardMetric("평균 점수", `${summary.averageScore}점`, "종료된 세션 기준")}
        ${dashboardMetric("출석 회원", `${memberStatus.attended}명`, "운동 기록 보유")}
        ${dashboardMetric("녹화 저장", `${summary.recordings}개`, "로컬 브라우저 저장")}
      </div>

      <section class="dashboard-main">
        <article class="admin-board member-status-card">
          <div class="dashboard-section-head">
            <div>
              <small>Members</small>
              <h3>회원 상태</h3>
            </div>
            <span class="badge">총 ${memberStatus.total}명</span>
          </div>
          <div class="member-status-body">
            <div class="donut-chart" style="--active:${activeDeg}deg; --idle:${idleDeg}deg">
              <div><strong>${memberStatus.total}</strong><span>회원</span></div>
            </div>
            <div class="status-legend">
              ${statusLegend("active", "출석", memberStatus.attended)}
              ${statusLegend("idle", "미운동", memberStatus.idle)}
              ${statusLegend("expired", "만료", memberStatus.expired)}
            </div>
          </div>
        </article>

        <article class="admin-board attention-card">
          <div class="dashboard-section-head">
            <div>
              <small>Ranking</small>
              <h3>체육관 회원 점수 랭킹</h3>
            </div>
          </div>
          <div class="ranking-list">
            ${memberScoreRanking().map((item, index) => rankingItem(index + 1, item.member.name, `${item.score}점`)).join("") || `<p class="empty-note">아직 점수 기록이 없습니다.</p>`}
          </div>
        </article>
      </section>

      <section class="dashboard-bottom compact-bottom">
        <article class="admin-board">
          <div class="dashboard-section-head">
            <div>
              <small>Recent</small>
              <h3>최근 운동 기록</h3>
            </div>
            <button class="ghost small-button" id="dashboardMembers">회원 관리</button>
          </div>
          <div class="table-wrap">
            <table class="admin-table dashboard-table">
              <thead><tr><th>회원</th><th>시작</th><th>운동 시간</th><th>점수</th></tr></thead>
              <tbody>${recentRows || `<tr><td colspan="4">아직 운동 기록이 없습니다.</td></tr>`}</tbody>
            </table>
          </div>
        </article>
      </section>
    </section>`;
  $("#dashboardMembers").addEventListener("click", () => {
    state.activeView = "members";
    renderApp();
  });
}

function dashboardSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaySeconds = today.getTime() / 1000;
  const finished = state.sessions.filter((session) => session.ended_at);
  const scored = finished.filter((session) => Number(session.overall_score) > 0);
  const averageScore = scored.length
    ? Math.round(scored.reduce((total, session) => total + Number(session.overall_score || 0), 0) / scored.length)
    : 0;
  return {
    todaySessions: state.sessions.filter((session) => session.started_at >= todaySeconds).length,
    averageScore,
    recordings: Object.keys(state.localRecordings || {}).length,
    lowScoreSessions: scored.filter((session) => Number(session.overall_score) < 70).length,
    openSessions: state.sessions.filter((session) => !session.ended_at).length,
  };
}

function dashboardMemberStatus() {
  const total = state.members.length;
  const expired = state.members.filter((member, index) => memberUsageState(member, index) === "expired").length;
  const withSessions = new Set(state.sessions.map((session) => session.user_id));
  const idle = state.members.filter((member, index) => memberUsageState(member, index) !== "expired" && !withSessions.has(member.user_id)).length;
  const attended = Math.max(0, total - expired - idle);
  return { total, active: attended, attended, idle, expired };
}

function recentDashboardSessions() {
  return [...state.sessions]
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, 4)
    .map((session) => ({
      session,
      member: state.members.find((member) => member.user_id === session.user_id),
    }));
}

function dashboardMetric(label, value, note) {
  return `<article class="dashboard-metric"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`;
}

function statusLegend(kind, label, value) {
  return `<p><span class="legend-dot ${kind}"></span><strong>${value}</strong>${label}</p>`;
}

function attentionItem(label, value, note) {
  return `<div class="attention-item"><strong>${value}</strong><span>${label}</span><small>${note}</small></div>`;
}

function rankingItem(rank, name, value) {
  return `<div class="ranking-item"><strong>${rank}</strong><span>${escapeHtml(name)}</span><small>${value}</small></div>`;
}

function memberScoreRanking(limit = 5) {
  return state.members
    .map((member) => {
      const scores = sessionsForMember(member.user_id)
        .map((session) => Number(session.overall_score || 0))
        .filter((score) => score > 0);
      const score = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
      return { member, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function renderMembers() {
  const enriched = state.members.map((member, index) => ({
    ...member,
    index,
    usage: memberUsageState(member, index),
    recent: dateOffset(index * 2 + 1),
  }));
  const filtered = enriched.filter((member) => {
    const haystack = `${member.name} ${member.username || ""} ${member.phone || ""} ${member.email || ""}`.toLowerCase();
    const matchesSearch = haystack.includes(state.memberSearch.toLowerCase());
    const matchesFilter = state.memberFilter === "all" || member.usage === state.memberFilter;
    return matchesSearch && matchesFilter;
  });
  const activeCount = enriched.filter((member) => member.usage === "active").length;
  const expiredCount = enriched.filter((member) => member.usage === "expired").length;
  const rows = filtered.map((member) => {
    const memberSessions = sessionsForMember(member.user_id);
    const latestSession = memberSessions[0];
    const registerDate = memberRegisteredDate(member, member.index);
    const expireDate = memberExpireDate(registerDate);
    return `<tr>
      <td><span class="avatar">${member.name.slice(0, 1)}</span>${member.name}</td>
      <td>${memberAge(member.birthdate) || "-"}</td>
      <td>${member.phone || "-"}</td>
      <td>${registerDate}</td>
      <td>${expireDate}</td>
      <td>${latestSession ? formatDateTime(latestSession.started_at) : "-"}</td>
      <td>
        <div class="record-actions">
          <button class="ghost small-button" data-member-edit="${member.id}">수정</button>
          <button class="ghost small-button" data-member-records="${member.id}">운동기록 ${memberSessions.length}</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  const form = state.showMemberForm ? memberCreateForm() : "";
  const selectedMember = filtered.find((member) => member.id === state.selectedMemberId) || filtered[0];
  if (!state.selectedMemberId && selectedMember) state.selectedMemberId = selectedMember.id;
  const editMember = state.members.find((member) => member.id === state.editingMemberId);
  const editPanel = editMember ? memberEditPanel(editMember) : "";
  const recordPanel = selectedMember ? memberRecordPanel(selectedMember) : "";
  $("#viewContent").innerHTML = `
    <section class="admin-board">
      <div class="admin-toolbar">
        <div class="segmented">
          <button class="${state.memberFilter === "all" ? "active" : ""}" data-member-filter="all">전체 회원 ${enriched.length}</button>
          <button class="${state.memberFilter === "active" ? "active" : ""}" data-member-filter="active">이용중 ${activeCount}</button>
          <button class="${state.memberFilter === "expired" ? "active" : ""}" data-member-filter="expired">만료 ${expiredCount}</button>
        </div>
        <label class="search-box"><span>검색</span><input id="memberSearch" value="${escapeHtml(state.memberSearch)}" placeholder="이름, 연락처 검색" /></label>
      </div>
      ${form}
      ${editPanel}
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>이름</th><th>나이</th><th>전화번호</th><th>등록일</th><th>만료일</th><th>최근 운동</th><th>관리</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7">조건에 맞는 회원이 없습니다.</td></tr>`}</tbody>
        </table>
      </div>
      ${recordPanel}
      <div class="admin-actions">
        <button id="toggleMemberForm">${state.showMemberForm ? "등록 취소" : "회원 등록"}</button>
      </div>
    </section>`;
  document.querySelectorAll("[data-member-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.memberFilter = button.dataset.memberFilter;
      renderMembers();
    });
  });
  $("#memberSearch").addEventListener("input", (event) => {
    state.memberSearch = event.target.value;
    renderMembers();
  });
  document.querySelectorAll("[data-member-records]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMemberId = button.dataset.memberRecords;
      state.editingMemberId = "";
      state.selectedRecordIds.clear();
      renderMembers();
    });
  });
  document.querySelectorAll("[data-member-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingMemberId = button.dataset.memberEdit;
      renderMembers();
    });
  });
  $("#toggleMemberForm").addEventListener("click", () => {
    state.showMemberForm = !state.showMemberForm;
    renderMembers();
  });
  document.querySelectorAll("[data-recording-id]").forEach((button) => {
    button.addEventListener("click", () => playRecording(button.dataset.recordingId));
  });
  document.querySelectorAll("[data-download-recording-id]").forEach((button) => {
    button.addEventListener("click", () => downloadRecording(button.dataset.downloadRecordingId));
  });
  document.querySelectorAll("[data-download-feedback-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = state.sessions.find((item) => item.id === button.dataset.downloadFeedbackId);
      const report = parseFeedbackReport(session);
      if (report) downloadFeedbackCsv(report);
    });
  });
  document.querySelectorAll("[data-record-check]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedRecordIds.add(checkbox.dataset.recordCheck);
      } else {
        state.selectedRecordIds.delete(checkbox.dataset.recordCheck);
      }
      renderMembers();
    });
  });
  const selectAllRecords = $("#selectAllRecords");
  if (selectAllRecords) {
    selectAllRecords.addEventListener("click", () => {
      sessionsForMember(selectedMember.user_id).forEach((session) => state.selectedRecordIds.add(session.id));
      renderMembers();
    });
  }
  const clearRecordSelection = $("#clearRecordSelection");
  if (clearRecordSelection) {
    clearRecordSelection.addEventListener("click", () => {
      state.selectedRecordIds.clear();
      renderMembers();
    });
  }
  const deleteSelectedRecords = $("#deleteSelectedRecords");
  if (deleteSelectedRecords) {
    deleteSelectedRecords.addEventListener("click", deleteSelectedMemberRecords);
  }
  const formEl = $("#memberCreateForm");
  if (formEl) {
    formEl.addEventListener("submit", createMemberFromForm);
  }
  const editForm = $("#memberEditForm");
  if (editForm) {
    editForm.addEventListener("submit", updateMemberFromForm);
    $("#cancelMemberEdit").addEventListener("click", () => {
      state.editingMemberId = "";
      renderMembers();
    });
  }
}

function memberRecordPanel(member) {
  const sessions = sessionsForMember(member.user_id);
  const selectedCount = sessions.filter((session) => state.selectedRecordIds.has(session.id)).length;
  const rows = sessions.map((session) => {
    const recording = state.localRecordings[session.id];
    const status = session.ended_at ? "완료" : "진행 중";
    const report = parseFeedbackReport(session);
    const actions = [
      recording ? `<button class="ghost small-button" data-recording-id="${session.id}">녹화 보기</button>` : "",
      recording ? `<button class="ghost small-button" data-download-recording-id="${session.id}">다운로드</button>` : "",
      report ? `<button class="ghost small-button" data-download-feedback-id="${session.id}">피드백 저장</button>` : "",
    ].filter(Boolean).join("");
    return `<tr>
      <td><input type="checkbox" data-record-check="${session.id}" ${state.selectedRecordIds.has(session.id) ? "checked" : ""} /></td>
      <td>${formatDateTime(session.started_at)}</td>
      <td>${session.ended_at ? formatDuration(session.started_at, session.ended_at) : "측정 중"}</td>
      <td>${session.overall_score || 0}</td>
      <td>${status}</td>
      <td><div class="record-actions">${actions || "-"}</div></td>
    </tr>`;
  }).join("");
  return `<section class="record-panel">
    <div class="record-panel-head">
      <div>
        <small>운동기록</small>
        <h3>${member.name}</h3>
      </div>
      <div class="record-bulk-actions">
        <span>${selectedCount}개 선택</span>
        <button class="ghost small-button" id="selectAllRecords">전체 선택</button>
        <button class="ghost small-button" id="clearRecordSelection">전체 해제</button>
        <button class="delete-button small-button" id="deleteSelectedRecords" ${selectedCount ? "" : "disabled"}>선택 삭제</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="admin-table record-table">
        <thead><tr><th>선택</th><th>시작 시간</th><th>운동 시간</th><th>점수</th><th>상태</th><th>파일</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">저장된 운동기록이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function memberEditPanel(member) {
  return `<form id="memberEditForm" class="member-create-form edit-member-form">
    <strong>회원 정보 수정</strong>
    <input name="name" value="${escapeHtml(member.name || "")}" placeholder="이름" required />
    <input name="phone" value="${escapeHtml(member.phone || "")}" placeholder="전화번호" />
    <select name="gender">
      ${profileOption("", "성별 선택", member.gender)}
      ${profileOption("male", "남성", member.gender)}
      ${profileOption("female", "여성", member.gender)}
      ${profileOption("other", "기타", member.gender)}
    </select>
    <select name="height_cm">
      ${numberOptions(140, 210, Number(member.height_cm || 170), "cm")}
    </select>
    <select name="weight_kg">
      ${numberOptions(40, 140, Number(member.weight_kg || 70), "kg")}
    </select>
    <select name="reach_cm">
      ${numberOptions(140, 220, Number(member.reach_cm || 172), "cm")}
    </select>
    <select name="stance">
      ${profileOption("orthodox", "오소독스", member.stance)}
      ${profileOption("southpaw", "사우스포", member.stance)}
    </select>
    <input name="injury_note" value="${escapeHtml(member.injury_note || "")}" placeholder="주의 사항" />
    <div class="record-actions">
      <button>수정 완료</button>
      <button type="button" class="ghost" id="cancelMemberEdit">취소</button>
    </div>
    <p id="memberEditMessage" class="form-message"></p>
  </form>`;
}

function sessionsForMember(userId) {
  return state.sessions
    .filter((session) => session.user_id === userId)
    .sort((a, b) => b.started_at - a.started_at);
}

function memberCreateForm() {
  return `<form id="memberCreateForm" class="member-create-form">
    <input name="username" placeholder="아이디" required />
    <input name="name" placeholder="이름" required />
    <input name="email" type="email" placeholder="이메일" required />
    <input name="password" type="password" placeholder="비밀번호: 특수문자 포함 8자리 이상" required />
    <input name="password_confirm" type="password" placeholder="비밀번호 확인" required />
    <input name="phone" placeholder="전화번호" />
    <select name="birthdate">
      ${birthYearOptions()}
    </select>
    <select name="gender">
      <option value="">성별 선택</option>
      <option value="male">남성</option>
      <option value="female">여성</option>
      <option value="other">기타</option>
    </select>
    <button>등록</button>
    <p id="memberCreateMessage" class="form-message"></p>
  </form>`;
}

async function createMemberFromForm(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  $("#memberCreateMessage").textContent = "";
  try {
    if (body.password !== body.password_confirm) throw new Error("비밀번호 확인이 일치하지 않습니다.");
    if (!isValidPassword(body.password)) throw new Error("비밀번호는 특수문자를 포함해 8자리 이상이어야 합니다.");
    const created = await api("/members", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.members.push(created.member);
    state.showMemberForm = false;
    renderMembers();
  } catch (error) {
    $("#memberCreateMessage").textContent = error.message;
  }
}

function memberUsageState(member, index) {
  return index % 4 === 0 && index !== 0 ? "expired" : "active";
}

function memberRegisteredDate(member, index = 0) {
  const firstSession = sessionsForMember(member.user_id).at(-1);
  if (firstSession?.started_at) return new Date(firstSession.started_at * 1000).toISOString().slice(0, 10);
  return dateOffset(index * 7 + 14);
}

function memberExpireDate(registeredDate) {
  const date = new Date(`${registeredDate}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function memberAge(birthdate) {
  if (!birthdate) return "";
  const birth = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age > 0 ? `${age}세` : "";
}

function birthYearOptions(selected = "") {
  const currentYear = new Date().getFullYear();
  const options = [`<option value="">출생연도 선택</option>`];
  for (let year = currentYear - 80; year <= currentYear - 5; year++) {
    const value = `${year}-01-01`;
    options.push(profileOption(value, `${year}년생`, selected));
  }
  return options.join("");
}

function numberOptions(start, end, selected, suffix = "") {
  const options = [];
  for (let value = start; value <= end; value++) {
    options.push(`<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${value}${suffix}</option>`);
  }
  return options.join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function updateMemberFromForm(event) {
  event.preventDefault();
  const member = state.members.find((item) => item.id === state.editingMemberId);
  if (!member) return;
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  ["height_cm", "weight_kg", "reach_cm"].forEach((key) => {
    body[key] = Number(body[key] || 0);
  });
  try {
    const result = await api(`/members/${member.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    state.members = state.members.map((item) => item.id === member.id ? { ...item, ...result.member } : item);
    state.editingMemberId = "";
    renderMembers();
  } catch (error) {
    $("#memberEditMessage").textContent = error.message;
  }
}

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
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
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

function openAccountModal() {
  state.accountModalOpen = true;
  renderSettings();
}

function closeAccountModal() {
  state.accountModalOpen = false;
  const modal = $("#accountModal");
  if (modal) modal.remove();
}

function renderAccountModal() {
  closeAccountModal();
  state.accountModalOpen = true;
  const profile = state.profile || {};
  const modal = document.createElement("div");
  modal.id = "accountModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="confirm-modal account-modal">
      <strong>관리자 정보 수정</strong>
      <form id="accountEditForm" class="account-edit-form">
        <label class="center-field"><span>이름</span><input name="name" value="${escapeHtml(profile.name || state.user.name || "")}" required /></label>
        <label class="center-field"><span>전화번호</span><input name="phone" value="${escapeHtml(profile.phone || "")}" /></label>
        <label class="center-field"><span>성별</span><select name="gender">
          ${profileOption("", "성별 선택", profile.gender)}
          ${profileOption("male", "남성", profile.gender)}
          ${profileOption("female", "여성", profile.gender)}
          ${profileOption("other", "기타", profile.gender)}
        </select></label>
        <label class="center-field"><span>키</span><select name="height_cm">${numberOptions(140, 210, Number(profile.height_cm || 170), "cm")}</select></label>
        <label class="center-field"><span>몸무게</span><select name="weight_kg">${numberOptions(40, 140, Number(profile.weight_kg || 70), "kg")}</select></label>
        <label class="center-field"><span>스탠스</span><select name="stance">
          ${profileOption("orthodox", "오소독스", profile.stance)}
          ${profileOption("southpaw", "사우스포", profile.stance)}
        </select></label>
        <label class="center-field full"><span>기본 정보</span><textarea name="injury_note">${escapeHtml(profile.injury_note || "")}</textarea></label>
        <p id="accountEditMessage" class="form-message"></p>
        <div class="modal-actions">
          <button>수정 완료</button>
          <button type="button" class="ghost" id="closeAccountModal">취소</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  $("#accountEditForm").addEventListener("submit", saveAccountFromModal);
  $("#closeAccountModal").addEventListener("click", closeAccountModal);
  modal.addEventListener("click", (event) => {
    if (event.target.id === "accountModal") closeAccountModal();
  });
}

async function saveAccountFromModal(event) {
  event.preventDefault();
  const profileId = state.profile?.id;
  if (!profileId) return;
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  ["height_cm", "weight_kg"].forEach((key) => {
    body[key] = Number(body[key] || 0);
  });
  try {
    const result = await api(`/members/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    state.profile = result.member;
    state.user.name = result.member.name || state.user.name;
    state.center.owner = state.user.name;
    saveCenterProfile();
    setSettingsMessage("관리자 정보를 수정했습니다.");
    closeAccountModal();
    renderApp();
  } catch (error) {
    $("#accountEditMessage").textContent = error.message;
  }
}

function logout() {
  localStorage.removeItem("boxing_token");
  location.reload();
}

function defaultCenterProfile() {
  return {
    name: "APEX Boxing Lab",
    owner: "김관리자",
    code: "apex",
    phone: "02-0000-0000",
    address: "서울시 강남구 테헤란로 100",
    weekdayHours: "06:00 - 23:00",
    weekendHours: "09:00 - 18:00",
    ringCount: 1,
    bagCount: 8,
    defaultCamera: "cam_front_01",
    defaultFocus: "guard_and_strikes",
    defaultSessionMinutes: 3,
    defaultSessionSeconds: 0,
    defaultSessionDurationSeconds: 180,
    monthlyMembershipPrice: 120000,
  };
}

function loadCenterProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(CENTER_KEY) || "{}");
    return normalizeCenterProfile({ ...defaultCenterProfile(), ...saved }, saved);
  } catch {
    return defaultCenterProfile();
  }
}

function saveCenterProfile() {
  state.center = normalizeCenterProfile(state.center);
  localStorage.setItem(CENTER_KEY, JSON.stringify(state.center));
}

function normalizeCenterProfile(profile, saved = profile) {
  const minutes = Math.max(0, Math.floor(Number(profile.defaultSessionMinutes || 0)));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(profile.defaultSessionSeconds || 0))));
  const savedDuration = Object.prototype.hasOwnProperty.call(saved, "defaultSessionDurationSeconds")
    ? Math.max(0, Math.round(Number(saved.defaultSessionDurationSeconds || 0)))
    : 0;
  const duration = savedDuration || minutes * 60 + seconds || 180;
  return {
    ...profile,
    defaultSessionMinutes: Math.floor(duration / 60),
    defaultSessionSeconds: duration % 60,
    defaultSessionDurationSeconds: duration,
  };
}

function sessionDurationSecondsFromCenter() {
  const minutes = Math.max(0, Math.floor(Number(state.center.defaultSessionMinutes || 0)));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(state.center.defaultSessionSeconds || 0))));
  return Math.max(1, minutes * 60 + seconds);
}

function renderCenterInfo() {
  const summary = dashboardSummary();
  const memberStatus = dashboardMemberStatus();
  const center = state.center;
  const revenue = centerRevenueSummary();
  $("#viewContent").innerHTML = `
    <section class="center-layout">
      <article class="admin-board center-profile-card">
        <div class="center-hero">
          <div>
            <small>Center Profile</small>
            <h3>${escapeHtml(center.name)}</h3>
            <p>${escapeHtml(center.address)}</p>
          </div>
          <span class="badge">운영 중</span>
        </div>
        <div class="center-metrics">
          ${centerMetric("등록 회원", `${state.members.length}명`)}
          ${centerMetric("출석 회원", `${memberStatus.attended}명`)}
          ${centerMetric("오늘 세션", `${summary.todaySessions}건`)}
          ${centerMetric("평균 점수", `${summary.averageScore}점`)}
        </div>
      </article>

      <section class="center-grid">
        <article class="admin-board center-panel">
          <div class="dashboard-section-head">
            <div>
              <small>Basic</small>
              <h3>센터 기본 정보</h3>
            </div>
          </div>
          <div class="center-form-grid">
            ${centerInput("name", "센터명", center.name)}
            ${centerInput("owner", "대표자", center.owner)}
            ${centerInput("code", "센터 코드", center.code)}
            ${centerInput("phone", "연락처", center.phone)}
            ${centerInput("address", "주소", center.address)}
            ${centerInput("weekdayHours", "평일 운영시간", center.weekdayHours)}
            ${centerInput("weekendHours", "주말 운영시간", center.weekendHours)}
          </div>
        </article>

        <article class="admin-board center-panel">
          <div class="dashboard-section-head">
            <div>
              <small>Facility</small>
              <h3>시설/장비 상태</h3>
            </div>
          </div>
          <div class="center-form-grid compact">
            ${centerInput("ringCount", "링 수", center.ringCount, "number")}
            ${centerInput("bagCount", "샌드백 수", center.bagCount, "number")}
          </div>
          <div class="facility-status">
            ${facilityItem("링", `${center.ringCount}개`, "스파링/미트 공간")}
            ${facilityItem("샌드백", `${center.bagCount}개`, "타격 훈련")}
          </div>
        </article>

        <article class="admin-board center-panel">
          <div class="dashboard-section-head">
            <div>
              <small>Coaching</small>
              <h3>코칭 기본값</h3>
            </div>
          </div>
          <div class="center-form-grid compact">
            ${centerInput("defaultCamera", "기본 카메라", center.defaultCamera)}
            ${centerSelect("defaultFocus", "기본 코칭 초점", center.defaultFocus, coachingFocusOptions())}
            ${centerRoundDurationFields(center)}
          </div>
        </article>

        <article class="admin-board center-panel">
          <div class="dashboard-section-head">
            <div>
              <small>Revenue</small>
              <h3>매출</h3>
            </div>
          </div>
          <div class="center-form-grid compact revenue-summary">
            ${centerInput("monthlyMembershipPrice", "한달 이용권 가격", center.monthlyMembershipPrice, "number")}
            ${centerMetric("이용중 회원", `${revenue.activeMembers}명`)}
            ${centerMetric("예상 월 매출", currency(revenue.currentMonthly))}
          </div>
          <div class="revenue-chart" aria-label="최근 6개월 매출 차트">
            <div class="revenue-y-axis">
              ${revenue.ticks.map((tick) => `<span>${shortCurrency(tick)}</span>`).join("")}
            </div>
            <div class="revenue-plot">
              ${revenue.months.map((item) => `
                <div class="revenue-column" style="--bar:${item.percent}%">
                  <span class="revenue-stick"></span>
                </div>`).join("")}
            </div>
            <div class="revenue-x-axis">
              ${revenue.months.map((item) => `<span>${item.label}</span>`).join("")}
            </div>
          </div>
        </article>
      </section>

      <div class="center-actions">
        <button id="saveCenterInfo">센터 정보 저장</button>
        <button id="resetCenterInfo" class="ghost">초기화</button>
        <p class="form-message">${state.centerMessage}</p>
      </div>
    </section>`;
  document.querySelectorAll("[data-center-field]").forEach((input) => {
    const updateCenterField = () => {
      const key = input.dataset.centerField;
      state.center[key] = input.type === "number" ? Number(input.value || 0) : input.value;
      if (key === "defaultSessionMinutes" || key === "defaultSessionSeconds") {
        state.center.defaultSessionMinutes = Math.max(0, Math.floor(Number(state.center.defaultSessionMinutes || 0)));
        state.center.defaultSessionSeconds = Math.max(0, Math.min(59, Math.floor(Number(state.center.defaultSessionSeconds || 0))));
        state.center.defaultSessionDurationSeconds = sessionDurationSecondsFromCenter();
      }
    };
    input.addEventListener("input", updateCenterField);
    input.addEventListener("change", updateCenterField);
  });
  $("#saveCenterInfo").addEventListener("click", () => {
    saveCenterProfile();
    state.centerMessage = "센터 정보를 저장했습니다.";
    renderCenterInfo();
  });
  $("#resetCenterInfo").addEventListener("click", () => {
    state.center = defaultCenterProfile();
    saveCenterProfile();
    state.centerMessage = "센터 정보를 기본값으로 초기화했습니다.";
    renderCenterInfo();
  });
}

function centerInput(key, label, value, type = "text") {
  return `<label class="center-field"><span>${label}</span><input data-center-field="${key}" type="${type}" value="${escapeHtml(value)}" /></label>`;
}

function centerRoundDurationFields(center) {
  return `<div class="center-field round-duration-field">
    <span>기본 라운드 시간</span>
    <div class="round-duration-inputs">
      <label><input data-center-field="defaultSessionMinutes" type="number" min="0" max="99" value="${escapeHtml(center.defaultSessionMinutes)}" /><small>분</small></label>
      <label><input data-center-field="defaultSessionSeconds" type="number" min="0" max="59" value="${escapeHtml(center.defaultSessionSeconds)}" /><small>초</small></label>
    </div>
  </div>`;
}

function centerSelect(key, label, value, options) {
  return `<label class="center-field"><span>${label}</span><select data-center-field="${key}">${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${String(value) === optionValue ? "selected" : ""}>${optionLabel}</option>`).join("")}</select></label>`;
}

function centerMetric(label, value) {
  return `<div><small>${label}</small><strong>${value}</strong></div>`;
}

function coachingFocusOptions() {
  return [
    ["guard_and_strikes", "가드 · 펀치 회수"],
    ["jab", "잽"],
    ["one_two", "원투"],
    ["footwork", "풋워크"],
    ["balance", "중심 이동"],
    ["defense", "방어 자세"],
  ];
}

function centerRevenueSummary() {
  const activeMembers = state.members.filter((member, index) => memberUsageState(member, index) === "active").length;
  const price = Number(state.center.monthlyMembershipPrice || 0);
  const currentMonthly = activeMembers * price;
  const now = new Date();
  const months = [];
  for (let index = 5; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const ratio = 0.72 + (6 - index) * 0.055;
    const amount = Math.round(currentMonthly * Math.min(1, ratio));
    months.push({
      label: `${date.getMonth() + 1}월`,
      amount,
      percent: currentMonthly ? Math.max(12, Math.round((amount / currentMonthly) * 100)) : 0,
    });
  }
  const maxAmount = Math.max(currentMonthly, ...months.map((item) => item.amount), 1);
  const tickUnit = Math.max(10000, Math.ceil(maxAmount / 4 / 10000) * 10000);
  const topTick = tickUnit * 4;
  const ticks = [topTick, tickUnit * 3, tickUnit * 2, tickUnit, 0];
  months.forEach((item) => {
    item.percent = Math.max(4, Math.round((item.amount / topTick) * 100));
  });
  return { activeMembers, currentMonthly, months, ticks };
}

function currency(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function shortCurrency(value) {
  const amount = Number(value || 0);
  if (amount >= 10000) return `${Math.round(amount / 10000).toLocaleString("ko-KR")}만`;
  return `${amount.toLocaleString("ko-KR")}원`;
}

function facilityItem(label, value, note) {
  return `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function defaultStaff() {
  return [
    {
      id: "staff_owner",
      name: "김관리자",
      role: "관리자",
      phone: "010-1000-1000",
      area: "총괄 · AI 코칭",
      status: "근무 중",
      schedule: "월-금 10:00-21:00",
      memo: "신규 회원 상담과 코칭 품질 점검 담당",
    },
    {
      id: "staff_coach",
      name: "박코치",
      role: "코치",
      phone: "010-2000-2000",
      area: "초급반 · 미트",
      status: "근무 중",
      schedule: "월/수/금 14:00-22:00",
      memo: "가드 복귀와 풋워크 교정 담당",
    },
    {
      id: "staff_manager",
      name: "이매니저",
      role: "운영",
      phone: "010-3000-3000",
      area: "회원 등록 · 출석",
      status: "휴무",
      schedule: "화-토 09:00-18:00",
      memo: "이용권 관리와 공지 전달 담당",
    },
  ];
}

function loadStaff() {
  try {
    return JSON.parse(localStorage.getItem(STAFF_KEY) || "null") || defaultStaff();
  } catch {
    return defaultStaff();
  }
}

function saveStaff() {
  localStorage.setItem(STAFF_KEY, JSON.stringify(state.staff));
}

function renderStaff() {
  const selected = state.staff.find((staff) => staff.id === state.selectedStaffId);
  const roleCounts = staffRoleCounts();
  const workingCount = state.staff.filter((staff) => staff.status === "근무 중").length;
  const rows = state.staff.map((staff) => `
    <tr class="${selected?.id === staff.id ? "selected-row" : ""}">
      <td><span class="avatar">${staff.name.slice(0, 1)}</span>${escapeHtml(staff.name)}</td>
      <td>${escapeHtml(staff.role)}</td>
      <td>${escapeHtml(staff.phone)}</td>
      <td>${escapeHtml(staff.area)}</td>
      <td><span class="status-pill ${staff.status === "근무 중" ? "active" : "off"}">${escapeHtml(staff.status)}</span></td>
      <td><button class="ghost small-button" data-staff-select="${staff.id}">수정</button></td>
    </tr>`).join("");
  $("#viewContent").innerHTML = `
    <section class="staff-layout">
      <div class="dashboard-kpis">
        ${dashboardMetric("전체 직원", `${state.staff.length}명`, "등록된 직원")}
        ${dashboardMetric("오늘 근무", `${workingCount}명`, "근무 중 상태")}
        ${dashboardMetric("코치", `${roleCounts.coach}명`, "코칭 담당")}
        ${dashboardMetric("운영 담당", `${roleCounts.operation}명`, "운영/관리")}
      </div>

      <section class="staff-main">
        <article class="admin-board">
          <div class="dashboard-section-head">
            <div>
              <small>Staff</small>
              <h3>직원 목록</h3>
            </div>
            <div class="settings-actions">
              <button id="toggleStaffForm">${state.showStaffForm ? "등록 취소" : "직원 등록"}</button>
            </div>
          </div>
          ${state.showStaffForm ? staffCreateForm() : ""}
          <div class="table-wrap">
            <table class="admin-table staff-table">
              <thead><tr><th>이름</th><th>역할</th><th>연락처</th><th>담당 영역</th><th>상태</th><th>관리</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="6">등록된 직원이 없습니다.</td></tr>`}</tbody>
            </table>
          </div>
        </article>

        ${selected ? `<aside class="admin-board staff-detail">${staffDetail(selected)}</aside>` : ""}
      </section>

      <p class="form-message staff-message">${state.staffMessage}</p>
    </section>`;
  $("#toggleStaffForm").addEventListener("click", () => {
    state.showStaffForm = !state.showStaffForm;
    renderStaff();
  });
  document.querySelectorAll("[data-staff-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStaffId = button.dataset.staffSelect;
      renderStaff();
    });
  });
  document.querySelectorAll("[data-staff-status]").forEach((button) => {
    button.addEventListener("click", () => updateStaffStatus(button.dataset.staffStatus));
  });
  const form = $("#staffCreateForm");
  if (form) form.addEventListener("submit", createStaffFromForm);
  const saveButton = $("#saveStaffDetail");
  if (saveButton) saveButton.addEventListener("click", saveSelectedStaffDetail);
  const deleteButton = $("#deleteStaff");
  if (deleteButton) deleteButton.addEventListener("click", deleteSelectedStaff);
  const closeButton = $("#closeStaffDetail");
  if (closeButton) {
    closeButton.addEventListener("click", () => {
      state.selectedStaffId = "";
      renderStaff();
    });
  }
}

function staffRoleCounts() {
  return {
    coach: state.staff.filter((staff) => staff.role.includes("코치")).length,
    operation: state.staff.filter((staff) => ["운영", "매니저", "관리자"].some((role) => staff.role.includes(role))).length,
  };
}

function staffCreateForm() {
  return `<form id="staffCreateForm" class="staff-create-form">
    <input name="name" placeholder="이름" required />
    <select name="role" required>
      <option value="코치">코치</option>
      <option value="운영">운영</option>
      <option value="관리자">관리자</option>
      <option value="파트타임">파트타임</option>
    </select>
    <input name="phone" placeholder="연락처" required />
    <input name="area" placeholder="담당 영역" required />
    <input name="schedule" placeholder="근무 스케줄" />
    <button>등록</button>
  </form>`;
}

function staffDetail(staff) {
  return `
    <div class="staff-profile">
      <span class="avatar large-avatar">${staff.name.slice(0, 1)}</span>
      <div>
        <small>Selected Staff</small>
        <h3>직원 정보 수정</h3>
        <p>${escapeHtml(staff.role)} · ${escapeHtml(staff.status)}</p>
      </div>
      <button id="closeStaffDetail" class="ghost small-button" type="button">닫기</button>
    </div>
    <div class="staff-status-actions">
      <button class="${staff.status === "근무 중" ? "active" : ""}" data-staff-status="근무 중">근무 중</button>
      <button class="${staff.status === "휴무" ? "active" : ""}" data-staff-status="휴무">휴무</button>
    </div>
    <div class="staff-detail-form">
      ${staffField("name", "이름", staff.name)}
      ${staffField("role", "역할", staff.role)}
      ${staffField("phone", "연락처", staff.phone)}
      ${staffField("area", "담당 영역", staff.area)}
      ${staffField("schedule", "근무 스케줄", staff.schedule)}
      <label class="center-field full"><span>내부 메모</span><textarea id="staffMemo">${escapeHtml(staff.memo || "")}</textarea></label>
    </div>
    <div class="staff-detail-actions">
      <button id="saveStaffDetail">수정 완료</button>
      <button id="deleteStaff" class="delete-button">직원 삭제</button>
    </div>`;
}

function staffField(key, label, value) {
  return `<label class="center-field"><span>${label}</span><input data-staff-field="${key}" value="${escapeHtml(value || "")}" /></label>`;
}

function createStaffFromForm(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  const staff = {
    id: `staff_${Date.now()}`,
    name: String(body.name || "").trim(),
    role: String(body.role || "코치"),
    phone: String(body.phone || ""),
    area: String(body.area || ""),
    status: "근무 중",
    schedule: String(body.schedule || ""),
    memo: "",
  };
  state.staff.push(staff);
  state.selectedStaffId = staff.id;
  state.showStaffForm = false;
  state.staffMessage = "직원을 등록했습니다.";
  saveStaff();
  renderStaff();
}

function saveSelectedStaffDetail() {
  const staff = state.staff.find((item) => item.id === state.selectedStaffId);
  if (!staff) return;
  document.querySelectorAll("[data-staff-field]").forEach((input) => {
    staff[input.dataset.staffField] = input.value;
  });
  staff.memo = $("#staffMemo").value;
  state.staffMessage = "직원 정보를 저장했습니다.";
  saveStaff();
  renderStaff();
}

function updateStaffStatus(status) {
  const staff = state.staff.find((item) => item.id === state.selectedStaffId);
  if (!staff) return;
  staff.status = status;
  state.staffMessage = `${staff.name} 상태를 ${status}(으)로 변경했습니다.`;
  saveStaff();
  renderStaff();
}

function deleteSelectedStaff() {
  const staff = state.staff.find((item) => item.id === state.selectedStaffId);
  if (!staff) return;
  if (!confirm(`${staff.name} 직원을 삭제할까요?`)) return;
  state.staff = state.staff.filter((item) => item.id !== staff.id);
  state.selectedStaffId = "";
  state.staffMessage = "직원을 삭제했습니다.";
  saveStaff();
  renderStaff();
}

function renderAttendance(selectedDay = new Date().getDate()) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const attendance = buildAttendance(year, month);
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(`<button class="calendar-day empty"></button>`);
  for (let day = 1; day <= lastDay; day++) {
    const list = attendance[day] || [];
    const weekendClass = dayOfWeekClass(year, month, day);
    cells.push(`<button class="calendar-day ${weekendClass} ${day === selectedDay ? "selected" : ""}" data-day="${day}">
      <strong>${day}</strong><span>${list.length}명 출석</span>
    </button>`);
  }
  const selected = attendance[selectedDay] || [];
  $("#viewContent").innerHTML = `
    <section class="attendance-layout">
      <div class="admin-board">
        <div class="calendar-head">
          <strong>${year}.${String(month + 1).padStart(2, "0")}</strong>
          <span>일자별 출석 인원</span>
        </div>
        <div class="calendar-week"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
        <div class="attendance-calendar">${cells.join("")}</div>
      </div>
      <aside class="admin-board attendance-detail">
        <small>${month + 1}월 ${selectedDay}일</small>
        <h3>${selected.length}명 출석</h3>
        <div>${selected.map((name) => `<p><span class="avatar">${name.slice(0, 1)}</span>${name}</p>`).join("") || "<p>출석 회원 없음</p>"}</div>
      </aside>
    </section>`;
  document.querySelectorAll(".calendar-day[data-day]").forEach((button) => {
    button.addEventListener("click", () => renderAttendance(Number(button.dataset.day)));
  });
}

function card(title, value, note) {
  return `<article class="data-card"><small>${title}</small><h3>${value}</h3><p>${note}</p></article>`;
}

function dateOffset(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(seconds) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startSeconds, endSeconds) {
  return elapsedText(startSeconds, endSeconds);
}

function elapsedText(startSeconds, endSeconds) {
  const elapsed = Math.max(0, Math.floor(endSeconds - startSeconds));
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildAttendance(year, month) {
  const names = state.members.map((member) => member.name);
  const data = {};
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const count = names.length ? ((day * 3) % (names.length + 1)) : 0;
    data[day] = names.slice(0, count);
  }
  return data;
}

function dayOfWeekClass(year, month, day) {
  const weekday = new Date(year, month, day).getDay();
  if (weekday === 0) return "sunday";
  if (weekday === 6) return "saturday";
  return "";
}

function emptyActionCounts() {
  return Object.fromEntries(ACTION_TYPES.map(([key]) => [key, 0]));
}

function emptyActionFeedback() {
  return Object.fromEntries(ACTION_TYPES.map(([key]) => [key, []]));
}

function startFeedbackSession() {
  state.feedbackWindow = newFeedbackWindow();
  state.sessionFeedback = {
    startedAt: Date.now(),
    windows: [],
    actionCounts: emptyActionCounts(),
    actionFeedback: emptyActionFeedback(),
    lastActionAt: {},
    recentActions: [],
  };
  state.lastMotionSample = null;
}

function clearFeedbackSession() {
  state.feedbackWindow = null;
  state.sessionFeedback = null;
  state.lastMotionSample = null;
  state.motionHistory = [];
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
  if (!state.sessionFeedback) return;
  if (!state.feedbackWindow) state.feedbackWindow = newFeedbackWindow();
  const events = detectMotionEvents(packet);
  state.feedbackWindow.packets.push(packet);
  state.feedbackWindow.events.push(...events);
  (packet.feedback_log || fallbackFeedbackLog(packet)).forEach((item) => {
    if (item.text) state.feedbackWindow.feedbackTexts.push(item.text);
  });
  events.forEach((event) => recordMotionEvent(event, packet));
  if (Date.now() - state.feedbackWindow.startedAt >= FEEDBACK_WINDOW_MS) flushFeedbackWindow();
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
  const keys = ["guard", "punch", "posture", "left_guard", "right_guard", "extension"];
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
  const addEvent = (type) => {
    const at = Date.now();
    if (canRecordMotion(type, at)) events.push({ type, at: packet.timestamp });
  };
  if (detectStraightPunch(current, previous, "left")) addEvent("jab");
  if (detectStraightPunch(current, previous, "right")) addEvent("right");
  if (detectHook(current, previous)) addEvent("hook");
  if (detectUppercut(current, previous)) addEvent("upper");
  if (detectDuck(current, previous)) addEvent("duck");
  if (detectWeave(current, previous)) addEvent("weave");
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
  const shoulderSpan = Math.max(Math.abs((rightShoulder.x || 0) - (leftShoulder.x || 0)), 0.1);
  const leftExtension = punchExtension(leftWrist, leftShoulder, shoulderSpan);
  const rightExtension = punchExtension(rightWrist, rightShoulder, shoulderSpan);
  const leftReliability = averageVisibility([leftShoulder, leftElbow, leftWrist]);
  const rightReliability = averageVisibility([rightShoulder, rightElbow, rightWrist]);
  const bodyReliability = averageVisibility([nose, leftShoulder, rightShoulder]);
  return {
    timestamp,
    leftExtension,
    rightExtension,
    extension: Math.max(leftExtension, rightExtension),
    leftX: leftWrist.x || 0,
    rightX: rightWrist.x || 0,
    leftY: leftWrist.y || 0,
    rightY: rightWrist.y || 0,
    noseY: points.nose?.y || 0,
    shoulderY: ((leftShoulder.y || 0) + (rightShoulder.y || 0)) / 2,
    shoulderCenterX: ((leftShoulder.x || 0) + (rightShoulder.x || 0)) / 2,
    leftReliability,
    rightReliability,
    bodyReliability,
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
    "noseY", "shoulderY", "shoulderCenterX", "leftReliability", "rightReliability", "bodyReliability",
  ];
  const smoothed = { ...sample };
  keys.forEach((key) => {
    smoothed[key] = state.motionHistory.reduce((sum, item) => sum + Number(item[key] || 0), 0) / state.motionHistory.length;
  });
  smoothed.trackable = sample.trackable;
  return smoothed;
}

function detectStraightPunch(current, previous, side) {
  const prefix = side === "left" ? "left" : "right";
  const reliability = current[`${prefix}Reliability`];
  const extension = current[`${prefix}Extension`];
  const previousExtension = previous[`${prefix}Extension`];
  const wristY = current[`${prefix}Y`];
  return reliability >= 0.42
    && extension >= 68
    && extension - previousExtension >= 10
    && Math.abs(wristY - current.shoulderY) <= 0.22;
}

function detectHook(current, previous) {
  const leftSwing = current.leftReliability >= 0.42
    && Math.abs(current.leftX - previous.leftX) >= 0.034
    && current.leftExtension >= 38
    && current.leftExtension <= 78;
  const rightSwing = current.rightReliability >= 0.42
    && Math.abs(current.rightX - previous.rightX) >= 0.034
    && current.rightExtension >= 38
    && current.rightExtension <= 78;
  return leftSwing || rightSwing;
}

function detectUppercut(current, previous) {
  const leftRise = current.leftReliability >= 0.42
    && previous.leftY - current.leftY >= 0.028
    && current.leftExtension >= 34
    && current.leftExtension <= 76;
  const rightRise = current.rightReliability >= 0.42
    && previous.rightY - current.rightY >= 0.028
    && current.rightExtension >= 34
    && current.rightExtension <= 76;
  return leftRise || rightRise;
}

function detectDuck(current, previous) {
  return current.bodyReliability >= 0.5
    && current.noseY - previous.noseY >= 0.035
    && Math.abs(current.shoulderCenterX - previous.shoulderCenterX) <= 0.035;
}

function detectWeave(current, previous) {
  return current.bodyReliability >= 0.5
    && current.noseY > current.shoulderY - 0.05
    && Math.abs(current.shoulderCenterX - previous.shoulderCenterX) >= 0.035;
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
    windows: session.windows || [],
    summary: buildSessionSummaryText(counts, feedback),
    summary_en: buildEnglishSessionSummaryText(counts, feedback),
  };
}

function buildSessionSummaryText(counts, feedback) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const top = ACTION_TYPES
    .map(([key, label]) => ({ key, label, count: counts[key] || 0 }))
    .sort((a, b) => b.count - a.count)[0];
  const main = top && top.count ? `${top.label}이 가장 많이 감지되었습니다(${top.count}회).` : "감지된 주요 동작이 아직 없습니다.";
  const firstFeedback = ACTION_TYPES.map(([key]) => feedback[key]?.[0]).find(Boolean) || "다음 라운드에서는 가드 유지와 펀치 회수를 우선 확인하세요.";
  return `총 ${total}회 동작 감지. ${main} ${firstFeedback}`;
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
  const modal = document.createElement("div");
  modal.id = "sessionFeedbackModal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="confirm-modal session-feedback-modal">
      <strong>라운드 피드백</strong>
      <p>${escapeHtml(report.summary)}</p>
      ${sessionFeedbackTable(report)}
      <div class="modal-actions">
        <button id="downloadLatestFeedbackCsv">피드백 저장</button>
        <button type="button" class="ghost" id="closeSessionFeedback">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  $("#downloadLatestFeedbackCsv").addEventListener("click", () => downloadFeedbackCsv(report));
  $("#closeSessionFeedback").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  speakText(sessionSummaryForVoice(report));
}

function sessionSummaryForVoice(report) {
  return voiceLanguage() === "en-US" ? report.summary_en || report.summary : report.summary;
}

function sessionFeedbackTable(report) {
  const rows = ACTION_TYPES.map(([key, label]) => {
    const items = report.actionFeedback?.[key] || [];
    const feedback = items.length ? items.join(" / ") : "감지된 동작 피드백 없음";
    return `<tr><td>${label}</td><td>${report.actionCounts?.[key] || 0}</td><td>${escapeHtml(feedback)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap feedback-report-wrap">
    <table class="admin-table feedback-report-table">
      <thead><tr><th>동작</th><th>빈도</th><th>피드백</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
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

async function startSession() {
  if (state.activeSessionId) return;
  resetHud();
  startFeedbackSession();
  const cameraReady = await prepareSessionCamera();
  if (!cameraReady) {
    clearFeedbackSession();
    return;
  }
  const created = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ focus: state.center.defaultFocus || "guard_and_strikes" }),
  });
  state.activeSessionId = created.session.id;
  state.activeSessionStartedAt = created.session.started_at;
  state.sessions.unshift(created.session);
  startRecording();
  startSessionTimer();
  startRoundTimer();
  updateSessionControls();
  playTone(660);
  await startPoseTracking(created.session.id);
}

async function prepareSessionCamera() {
  const stream = await startCamera();
  if (!stream) return false;
  try {
    await loadPoseLandmarker();
    $("#cameraStatus").textContent = "MediaPipe 카메라 인식 준비";
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
  const { FilesetResolver, PoseLandmarker } = await import(`${MEDIAPIPE_TASKS_BASE}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_TASKS_BASE}/wasm`);
  try {
    state.poseLandmarker = await createPoseLandmarker(PoseLandmarker, vision, "GPU");
  } catch (error) {
    console.warn("MediaPipe GPU delegate failed, retrying with CPU.", error);
    state.poseLandmarker = await createPoseLandmarker(PoseLandmarker, vision, "CPU");
  }
  return state.poseLandmarker;
}

function createPoseLandmarker(PoseLandmarker, vision, delegate) {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      delegate,
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  });
}

async function startPoseTracking(sessionId) {
  state.poseRunning = true;
  state.lastVideoTime = -1;
  state.poseTimestampMs = 0;
  state.poseErrorShown = false;
  $("#cameraStatus").textContent = "MediaPipe 모션 인식 중";
  const video = $("#cameraPreview");
  const tick = () => {
    if (!state.poseRunning || state.activeSessionId !== sessionId) return;
    updatePoseFromVideo(video, sessionId);
    state.poseLoop = requestAnimationFrame(tick);
  };
  tick();
}

function stopPoseTracking() {
  state.poseRunning = false;
  if (state.poseLoop) cancelAnimationFrame(state.poseLoop);
  state.poseLoop = null;
  state.lastVideoTime = -1;
  if (state.poseLandmarker) resetPoseLandmarker();
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
    if (String(error.message || error).includes("timestamp mismatch")) {
      resetPoseLandmarker();
    }
    if (state.poseErrorShown) return;
    state.poseErrorShown = true;
    $("#cameraStatus").textContent = "MediaPipe 추론 오류";
    $("#feedbackText").textContent = `모션 인식이 일시 중지되었습니다. 세션을 종료한 뒤 다시 시작해주세요. ${error.message}`;
    console.error(error);
  }
}

function nextPoseTimestampMs() {
  state.poseTimestampMs += 33;
  return state.poseTimestampMs;
}

function resetPoseLandmarker() {
  try {
    state.poseLandmarker?.close?.();
  } catch (error) {
    console.warn("MediaPipe close failed.", error);
  }
  state.poseLandmarker = null;
  state.poseTimestampMs = 0;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } },
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
  const stream = $("#cameraPreview").srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  $("#cameraPreview").srcObject = null;
  $("#cameraPreview").classList.remove("hidden");
  $("#cameraFallback").classList.remove("hidden");
  state.cameraReady = false;
  state.recordingStream = null;
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
  const response = await fetch("/api/recordings/convert", {
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
  const keypoints = Object.entries(poseIndexes).map(([name, index]) => {
    const point = landmarks[index];
    const score = point ? Math.min(point.visibility ?? point.presence ?? 1, 1) : 0;
    return {
      name,
      x: clamp(point?.x || 0),
      y: clamp(point?.y || 0),
      score: Number(score.toFixed(3)),
    };
  });
  const confidence = averageKeypointScore(keypoints);
  const status = confidence >= 0.45 ? "tracking" : "no_person";
  const metrics = boxingMetrics(keypoints);
  const score = status === "no_person" ? 0 : Math.round(metrics.guard * 0.42 + metrics.punch * 0.28 + metrics.posture * 0.30);
  const feedbackData = boxingFeedback(metrics, status);
  return {
    session_id: sessionId,
    camera_id: "browser_camera",
    view_angle: "front",
    timestamp: Date.now() / 1000,
    pose_sequence_id: `${sessionId}:${Math.floor(Date.now() / 1000)}`,
    keypoints,
    confidence: Number(confidence.toFixed(3)),
    action: feedbackData.action,
    score,
    feedback: feedbackData.feedback,
    feedback_log: feedbackData.logs,
    status,
    metrics,
  };
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
  const shoulderSpan = Math.abs(byName.right_shoulder.x - byName.left_shoulder.x);
  const extension = Math.max(
    punchExtension(byName.left_wrist, byName.left_shoulder, shoulderSpan),
    punchExtension(byName.right_wrist, byName.right_shoulder, shoulderSpan),
  );
  const punch = clampScore(100 - Math.max(0, extension - 82) * 1.6 - Math.max(0, 58 - guard) * 0.45);
  const centerX = (byName.left_hip.x + byName.right_hip.x) / 2;
  const shoulderCenterX = (byName.left_shoulder.x + byName.right_shoulder.x) / 2;
  const shoulderTilt = Math.abs(byName.left_shoulder.y - byName.right_shoulder.y);
  const posture = clampScore(100 - Math.abs(centerX - shoulderCenterX) * 260 - shoulderTilt * 210);
  return { guard, punch, posture, left_guard: leftGuard, right_guard: rightGuard, extension };
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
  $("#targetAction").textContent = packet.action;
  $("#scoreValue").textContent = packet.score;
  $("#confidenceValue").textContent = `confidence ${packet.confidence}`;
  $("#cameraStatus").textContent = `${packet.camera_id} · ${packet.view_angle} · ${packet.status}`;
  ingestPoseFeedback(packet);
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
  return [
    { label: "", text: packet.feedback, time },
    { label: "", text: `${packet.action} 동작에 집중하세요.`, time },
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

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCenterCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function isValidPassword(value) {
  return String(value || "").length >= 8 && /[^A-Za-z0-9]/.test(value);
}

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
hydrate();
