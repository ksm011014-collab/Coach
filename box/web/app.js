const SETTINGS_KEY = "boxing_settings";
const CENTER_KEY = "boxing_center_profile";

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
  selectedMemberId: "",
  activeSessionId: "",
  activeSessionStartedAt: 0,
  sessionTimer: null,
  recorder: null,
  recordedChunks: [],
  recordingStream: null,
  recordingCanvas: null,
  recordingFrame: null,
  localRecordings: {},
  pendingDeleteSessionId: "",
  poseLandmarker: null,
  poseLoop: null,
  poseRunning: false,
  lastVideoTime: -1,
  poseErrorShown: false,
  feedbackLog: [],
  lastFeedbackAt: 0,
  settings: loadSettings(),
  settingsMessage: "",
  center: loadCenterProfile(),
  centerMessage: "",
};

const navItems = [
  ["coach", "실시간 코칭"],
  ["dashboard", "대시보드"],
  ["center", "센터 정보"],
  ["members", "회원 관리"],
  ["staff", "직원"],
  ["attendance", "출석"],
  ["settings", "설정"],
];

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
    button: "회원가입",
    fields: [
      { name: "username", value: "", placeholder: "아이디", type: "text", withCheck: true },
      { name: "name", value: "", placeholder: "이름", type: "text" },
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
  body.role = "MEMBER";
  body.username = normalizeUsername(body.username);
  if (state.usernameChecked !== body.username) {
    throw new Error("아이디 중복 확인을 먼저 해주세요.");
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
  $("#app").className = `shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}`;
  $("#sidebar").classList.remove("hidden");
  $("#loginPanel").classList.add("hidden");
  $("#workspace").classList.toggle("hidden", state.activeView === "coach");
  $("#hud").classList.toggle("hidden", state.activeView !== "coach");
  $("#userName").textContent = `${state.user.name} · ${state.user.role === "OWNER" ? "관장" : "회원"}`;
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
      : `<div class="auth-links"><button type="button" class="link-button" data-auth-link="signup">회원가입하기</button><span></span><button type="button" class="link-button">비밀번호 찾기</button></div>`;
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
}

function renderField(field) {
  if (field.type === "select") {
    return `<select name="${field.name}" required>${field.options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("")}</select>`;
  }
  const input = `<input name="${field.name}" value="${field.value}" type="${field.type}" placeholder="${field.placeholder}" autocomplete="off" required />`;
  if (!field.withCheck) return input;
  return `<div class="username-row">${input}<button type="button" id="checkUsernameButton">중복 확인</button></div>`;
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
  const visible = navItems.filter(([key]) => state.user.role === "OWNER" || !["center", "members", "staff", "attendance"].includes(key));
  $("#nav").innerHTML = visible
    .map(([key, label]) => `<button class="nav-item ${state.activeView === key ? "active" : ""}" data-view="${key}"><span>${label}</span></button>`)
    .join("");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderApp();
      if (state.activeView === "coach") resetHud();
    });
  });
}

function renderView() {
  const titleMap = {
    dashboard: "대시보드",
    center: "센터 정보",
    members: "회원 관리",
    staff: "직원",
    attendance: "출석",
    settings: "설정",
  };
  $("#viewTitle").textContent = titleMap[state.activeView] || "대시보드";
  if (state.activeView === "dashboard") renderDashboard();
  if (state.activeView === "center") renderCenterInfo();
  if (state.activeView === "members") renderMembers();
  if (state.activeView === "staff") renderStaff();
  if (state.activeView === "attendance") renderAttendance();
  if (state.activeView === "settings") renderSettings();
}

function renderDashboard() {
  const summary = dashboardSummary();
  const memberStatus = dashboardMemberStatus();
  const totalMembers = Math.max(memberStatus.total, 1);
  const activeDeg = (memberStatus.active / totalMembers) * 360;
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
        ${dashboardMetric("활성 회원", `${memberStatus.active}명`, "운동 기록 보유")}
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
              ${statusLegend("active", "활성", memberStatus.active)}
              ${statusLegend("idle", "미운동", memberStatus.idle)}
              ${statusLegend("expired", "만료", memberStatus.expired)}
            </div>
          </div>
        </article>

        <article class="admin-board attention-card">
          <div class="dashboard-section-head">
            <div>
              <small>Focus</small>
              <h3>주의 필요</h3>
            </div>
          </div>
          <div class="attention-list">
            ${attentionItem("낮은 점수 세션", `${summary.lowScoreSessions}건`, "70점 미만 세션")}
            ${attentionItem("미완료 세션", `${summary.openSessions}건`, "종료 버튼 확인 필요")}
            ${attentionItem("운동 없는 회원", `${memberStatus.idle}명`, "첫 세션 유도")}
          </div>
        </article>
      </section>

      <section class="dashboard-bottom">
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

        <article class="admin-board quick-actions-card">
          <div class="dashboard-section-head">
            <div>
              <small>Actions</small>
              <h3>빠른 실행</h3>
            </div>
          </div>
          <div class="quick-actions">
            <button id="dashboardStart">실시간 코칭 시작</button>
            <button class="ghost" id="dashboardAddMember">회원 등록</button>
            <button class="ghost" id="dashboardExport">회원 CSV</button>
            <button class="ghost" id="dashboardSettings">설정 열기</button>
          </div>
        </article>
      </section>
    </section>`;
  $("#dashboardStart").addEventListener("click", async () => {
    state.activeView = "coach";
    renderApp();
    await startSession();
  });
  $("#dashboardAddMember").addEventListener("click", () => {
    state.activeView = "members";
    state.showMemberForm = true;
    renderApp();
  });
  $("#dashboardMembers").addEventListener("click", () => {
    state.activeView = "members";
    renderApp();
  });
  $("#dashboardExport").addEventListener("click", () => downloadMembersCsv(state.members));
  $("#dashboardSettings").addEventListener("click", () => {
    state.activeView = "settings";
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
  const active = Math.max(0, total - expired - idle);
  return { total, active, idle, expired };
}

function recentDashboardSessions() {
  return [...state.sessions]
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, 6)
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
    return `<tr>
      <td><span class="avatar">${member.name.slice(0, 1)}</span>${member.name}</td>
      <td>${member.username || "-"}</td>
      <td>${member.phone || "-"}</td>
      <td>${member.email || "-"}</td>
      <td>${member.birthdate || "-"}</td>
      <td>${latestSession ? formatDateTime(latestSession.started_at) : "-"}</td>
      <td><button class="ghost small-button" data-member-records="${member.id}">운동기록 ${memberSessions.length}</button></td>
    </tr>`;
  }).join("");
  const form = state.showMemberForm ? memberCreateForm() : "";
  const selectedMember = filtered.find((member) => member.id === state.selectedMemberId) || filtered[0];
  if (!state.selectedMemberId && selectedMember) state.selectedMemberId = selectedMember.id;
  const recordPanel = selectedMember ? memberRecordPanel(selectedMember) : "";
  $("#viewContent").innerHTML = `
    <section class="admin-board">
      <div class="admin-toolbar">
        <div class="segmented">
          <button class="${state.memberFilter === "all" ? "active" : ""}" data-member-filter="all">전체 회원 ${enriched.length}</button>
          <button class="${state.memberFilter === "active" ? "active" : ""}" data-member-filter="active">이용중 ${activeCount}</button>
          <button class="${state.memberFilter === "expired" ? "active" : ""}" data-member-filter="expired">만료 ${expiredCount}</button>
        </div>
        <label class="search-box"><span>검색</span><input id="memberSearch" value="${escapeHtml(state.memberSearch)}" placeholder="이름, 아이디, 연락처 검색" /></label>
      </div>
      ${form}
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>이름</th><th>아이디</th><th>전화번호</th><th>이메일</th><th>생년월일</th><th>최근 운동</th><th>기록</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7">조건에 맞는 회원이 없습니다.</td></tr>`}</tbody>
        </table>
      </div>
      ${recordPanel}
      <div class="admin-actions">
        <button class="ghost" id="downloadMembers">엑셀 다운로드</button>
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
  $("#downloadMembers").addEventListener("click", () => downloadMembersCsv(filtered));
  document.querySelectorAll("[data-member-records]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMemberId = button.dataset.memberRecords;
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
  document.querySelectorAll("[data-delete-session-id]").forEach((button) => {
    button.addEventListener("click", () => confirmDeleteSession(button.dataset.deleteSessionId));
  });
  const formEl = $("#memberCreateForm");
  if (formEl) {
    formEl.addEventListener("submit", createMemberFromForm);
  }
}

function memberRecordPanel(member) {
  const sessions = sessionsForMember(member.user_id);
  const rows = sessions.map((session) => {
    const recording = state.localRecordings[session.id];
    const status = session.ended_at ? "완료" : "진행 중";
    const recordingButton = recording
      ? `<button class="ghost small-button" data-recording-id="${session.id}">녹화 보기</button>`
      : "-";
    const deleteButton = `<button class="ghost small-button delete-button" data-delete-session-id="${session.id}">삭제</button>`;
    return `<tr>
      <td>${formatDateTime(session.started_at)}</td>
      <td>${session.ended_at ? formatDuration(session.started_at, session.ended_at) : "측정 중"}</td>
      <td>${session.overall_score || 0}</td>
      <td>${status}</td>
      <td><div class="record-actions">${recordingButton}${deleteButton}</div></td>
    </tr>`;
  }).join("");
  return `<section class="record-panel">
    <div>
      <small>운동기록</small>
      <h3>${member.name}</h3>
    </div>
    <div class="table-wrap">
      <table class="admin-table record-table">
        <thead><tr><th>시작 시간</th><th>운동 시간</th><th>점수</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">저장된 운동기록이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
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
    <input name="birthdate" type="date" />
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

function downloadMembersCsv(members) {
  const header = ["이름", "아이디", "전화번호", "이메일", "생년월일", "최근 출석일"];
  const lines = members.map((member) => [member.name, member.username || "", member.phone || "", member.email || "", member.birthdate || "", member.recent || ""]);
  const csv = [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "members.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function memberUsageState(member, index) {
  return index % 4 === 0 && index !== 0 ? "expired" : "active";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function defaultSettings() {
  return {
    theme: "dark",
    notifications: false,
    voice: false,
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
  const recordingCount = Object.keys(state.localRecordings || {}).length;
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
          <small>Data</small>
          <h3>데이터 관리</h3>
          <p>회원, 세션, 로컬 녹화 데이터를 내보내거나 정리합니다.</p>
        </div>
        <div class="settings-actions">
          <button id="exportMembers">회원 CSV 내보내기</button>
          <button id="exportSessions">세션 CSV 내보내기</button>
          <button id="exportBackup">전체 백업 JSON 저장</button>
          <button id="clearRecordings" class="delete-button">로컬 녹화 ${recordingCount}개 삭제</button>
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
          <p>${state.user.username} · ${state.user.role}</p>
        </div>
        <label class="settings-field">
          <span>표시 이름</span>
          <input id="accountName" value="${escapeHtml(state.profile?.name || state.user.name || "")}" />
        </label>
        <div class="settings-actions">
          <button id="saveAccountName">이름 저장</button>
          <button id="refreshAccount">계정 새로고침</button>
          <button id="settingsLogout" class="delete-button">로그아웃</button>
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
  document.querySelectorAll("[data-setting-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      state.settings[input.dataset.settingToggle] = input.checked;
      if (input.dataset.settingToggle === "notifications" && input.checked) requestNotifications();
      setSettingsMessage("설정이 저장되었습니다.");
      saveSettings();
      renderSettings();
    });
  });
  $("#exportMembers").addEventListener("click", () => downloadMembersCsv(state.members));
  $("#exportSessions").addEventListener("click", downloadSessionsCsv);
  $("#exportBackup").addEventListener("click", downloadBackupJson);
  $("#clearRecordings").addEventListener("click", clearRecordingsFromSettings);
  $("#requestNotifications").addEventListener("click", requestNotifications);
  $("#testVoice").addEventListener("click", () => speakText("음성 피드백이 켜져 있습니다.", true));
  $("#testSound").addEventListener("click", () => playTone(720));
  $("#saveAccountName").addEventListener("click", saveAccountName);
  $("#refreshAccount").addEventListener("click", refreshAccount);
  $("#settingsLogout").addEventListener("click", logout);
  $("#saveAllSettings").addEventListener("click", saveAllSettings);
  $("#resetSettings").addEventListener("click", resetSettings);
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

function downloadSessionsCsv() {
  const rows = state.sessions.map((session) => [
    session.id,
    session.user_id,
    session.focus || "",
    formatDateTime(session.started_at),
    session.ended_at ? formatDateTime(session.ended_at) : "",
    session.ended_at ? formatDuration(session.started_at, session.ended_at) : "",
    session.overall_score || 0,
  ]);
  downloadTextFile("sessions.csv", "\ufeff" + [
    ["세션ID", "회원ID", "목표", "시작", "종료", "운동시간", "점수"],
    ...rows,
  ].map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  setSettingsMessage("세션 CSV를 저장했습니다.");
  renderSettings();
}

function downloadBackupJson() {
  const payload = {
    exported_at: new Date().toISOString(),
    user: state.user,
    profile: state.profile,
    members: state.members,
    sessions: state.sessions,
    settings: state.settings,
    local_recordings: Object.values(state.localRecordings || {}).map(({ id, mimeType, size, savedAt }) => ({ id, mimeType, size, savedAt })),
  };
  downloadTextFile("boxing-coach-backup.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  setSettingsMessage("백업 JSON을 저장했습니다.");
  renderSettings();
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function clearRecordingsFromSettings() {
  await clearAllRecordings();
  state.localRecordings = {};
  setSettingsMessage("로컬 녹화를 삭제했습니다.");
  renderSettings();
}

async function clearAllRecordings() {
  if (!window.indexedDB) return;
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("recordings", "readwrite").objectStore("recordings").clear();
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
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
  utterance.lang = "ko-KR";
  utterance.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function speakFeedback(text) {
  const now = Date.now();
  if (now - state.lastFeedbackAt < state.settings.feedbackCooldownSeconds * 1000) return;
  state.lastFeedbackAt = now;
  speakText(text);
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

async function saveAccountName() {
  const name = $("#accountName").value.trim();
  if (!name) {
    setSettingsMessage("표시 이름을 입력해주세요.");
    renderSettings();
    return;
  }
  const profileId = state.profile?.id;
  if (!profileId) {
    setSettingsMessage("프로필 정보를 찾지 못했습니다.");
    renderSettings();
    return;
  }
  const result = await api(`/members/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  state.profile = result.member;
  state.user.name = name;
  setSettingsMessage("계정 이름을 저장했습니다.");
  renderApp();
}

async function refreshAccount() {
  const me = await api("/me");
  state.user = me.user;
  state.profile = me.profile;
  setSettingsMessage("계정 정보를 새로고침했습니다.");
  renderApp();
}

function logout() {
  localStorage.removeItem("boxing_token");
  location.reload();
}

function defaultCenterProfile() {
  return {
    name: "APEX Boxing Lab",
    owner: "김관장",
    phone: "02-0000-0000",
    address: "서울시 강남구 테헤란로 100",
    weekdayHours: "06:00 - 23:00",
    weekendHours: "09:00 - 18:00",
    ringCount: 1,
    bagCount: 8,
    cameraCount: 1,
    cameraStatus: "정상",
    defaultCamera: "cam_front_01",
    defaultFocus: "가드 · 펀치 회수",
    defaultSessionMinutes: 3,
    notice: "오늘은 가드 복귀와 중심 이동을 집중 코칭합니다.",
  };
}

function loadCenterProfile() {
  try {
    return { ...defaultCenterProfile(), ...JSON.parse(localStorage.getItem(CENTER_KEY) || "{}") };
  } catch {
    return defaultCenterProfile();
  }
}

function saveCenterProfile() {
  localStorage.setItem(CENTER_KEY, JSON.stringify(state.center));
}

function renderCenterInfo() {
  const summary = dashboardSummary();
  const memberStatus = dashboardMemberStatus();
  const center = state.center;
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
          ${centerMetric("활성 회원", `${memberStatus.active}명`)}
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
            ${centerInput("cameraCount", "카메라 수", center.cameraCount, "number")}
            ${centerInput("cameraStatus", "카메라 상태", center.cameraStatus)}
          </div>
          <div class="facility-status">
            ${facilityItem("링", `${center.ringCount}개`, "스파링/미트 공간")}
            ${facilityItem("샌드백", `${center.bagCount}개`, "타격 훈련")}
            ${facilityItem("카메라", `${center.cameraCount}대`, center.cameraStatus)}
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
            ${centerInput("defaultFocus", "기본 코칭 초점", center.defaultFocus)}
            ${centerInput("defaultSessionMinutes", "기본 라운드 시간(분)", center.defaultSessionMinutes, "number")}
          </div>
        </article>

        <article class="admin-board center-panel">
          <div class="dashboard-section-head">
            <div>
              <small>Notice</small>
              <h3>센터 공지</h3>
            </div>
          </div>
          <label class="center-field full">
            <span>회원 안내 문구</span>
            <textarea id="centerNotice">${escapeHtml(center.notice)}</textarea>
          </label>
        </article>
      </section>

      <div class="center-actions">
        <button id="saveCenterInfo">센터 정보 저장</button>
        <button id="resetCenterInfo" class="ghost">초기화</button>
        <p class="form-message">${state.centerMessage}</p>
      </div>
    </section>`;
  document.querySelectorAll("[data-center-field]").forEach((input) => {
    input.addEventListener("input", () => {
      state.center[input.dataset.centerField] = input.type === "number" ? Number(input.value || 0) : input.value;
    });
  });
  $("#centerNotice").addEventListener("input", (event) => {
    state.center.notice = event.target.value;
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

function centerMetric(label, value) {
  return `<div><small>${label}</small><strong>${value}</strong></div>`;
}

function facilityItem(label, value, note) {
  return `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function renderStaff() {
  const staff = [
    ["김관장", "총괄", "복싱 클래스 · AI 코칭"],
    ["박코치", "코치", "초급반 · 출석 관리"],
    ["이매니저", "운영", "회원 등록 · 이용권 관리"],
  ];
  $("#viewContent").innerHTML = `<section class="admin-board staff-grid">${staff
    .map(([name, role, note]) => card(name, role, note))
    .join("")}</section>`;
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
    cells.push(`<button class="calendar-day ${day === selectedDay ? "selected" : ""}" data-day="${day}">
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

async function startSession() {
  if (state.activeSessionId) return;
  resetHud();
  const cameraReady = await prepareSessionCamera();
  if (!cameraReady) return;
  const created = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ focus: "guard_and_strikes" }),
  });
  state.activeSessionId = created.session.id;
  state.activeSessionStartedAt = created.session.started_at;
  state.sessions.unshift(created.session);
  startRecording();
  startSessionTimer();
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
  state.activeSessionId = "";
  stopSessionTimer();
  const recording = await stopRecording(sessionId);
  stopPoseTracking();
  stopCamera();
  const result = await api(`/sessions/${sessionId}/end`, {
    method: "PATCH",
    body: JSON.stringify({ overall_score: score }),
  });
  state.sessions = state.sessions.map((session) => (session.id === sessionId ? result.session : session));
  if (recording) {
    state.localRecordings[sessionId] = recording;
  }
  playTone(420);
  notifyUser("운동 세션 종료", `점수 ${score}점으로 세션이 저장되었습니다.`);
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
}

function updatePoseFromVideo(video, sessionId) {
  if (!state.poseLandmarker || video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  try {
    const result = state.poseLandmarker.detectForVideo(video, Math.round(video.currentTime * 1000));
    const landmarks = result.landmarks && result.landmarks[0];
    const packet = packetFromLandmarks(sessionId, landmarks || []);
    state.latestPose = packet;
    updateHud(packet);
    drawSkeleton();
  } catch (error) {
    if (state.poseErrorShown) return;
    state.poseErrorShown = true;
    $("#cameraStatus").textContent = "MediaPipe 추론 오류";
    $("#feedbackText").textContent = `모션 인식이 시작되지 못했습니다. 새로고침 후 다시 시도해주세요. ${error.message}`;
    console.error(error);
  }
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
  const options = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
    ? { mimeType: "video/webm;codecs=vp8" }
    : {};
  state.recorder = new MediaRecorder(stream, options);
  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordedChunks.push(event.data);
  });
  state.recorder.start(1000);
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

function drawRecordingSkeleton(ctx, width, height) {
  if (!state.latestPose) return;
  const points = Object.fromEntries(state.latestPose.keypoints.map((point) => [
    point.name,
    { x: point.x * width, y: point.y * height },
  ]));
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
  drawRecordingCamera(ctx, width - 342, height - 232, 300, 190);
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

function drawRecordingCamera(ctx, x, y, width, height) {
  const video = $("#cameraPreview");
  ctx.save();
  roundRect(ctx, x, y, width, height, 8);
  ctx.fillStyle = "rgba(3, 18, 28, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(99, 234, 255, 0.36)";
  ctx.stroke();
  ctx.clip();
  if (video.readyState >= 2) {
    drawCoverImage(ctx, video, x, y, width, height);
  } else {
    ctx.fillStyle = "rgba(46, 232, 255, 0.10)";
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "rgba(198, 243, 255, 0.78)";
    ctx.font = "18px Arial";
    ctx.fillText("LIVE CAMERA", x + 84, y + height / 2);
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

function confirmDeleteSession(sessionId) {
  state.pendingDeleteSessionId = sessionId;
  $("#confirmModal").classList.remove("hidden");
}

function closeDeleteModal() {
  state.pendingDeleteSessionId = "";
  $("#confirmModal").classList.add("hidden");
}

async function deletePendingSession() {
  const sessionId = state.pendingDeleteSessionId;
  if (!sessionId) return;
  try {
    await api(`/sessions/${sessionId}`, { method: "DELETE" });
    await deleteRecording(sessionId);
    delete state.localRecordings[sessionId];
    state.sessions = state.sessions.filter((session) => session.id !== sessionId);
    closeDeleteModal();
    renderMembers();
  } catch (error) {
    alert(`삭제에 실패했습니다. 서버를 재시작한 뒤 다시 시도해주세요.\n\n${error.message}`);
  }
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

function updateSessionControls() {
  const isActive = Boolean(state.activeSessionId);
  $("#sessionState").textContent = isActive ? "녹화 중" : "대기 중";
  $("#sessionTimer").textContent = isActive ? elapsedText(state.activeSessionStartedAt, Date.now() / 1000) : "00:00";
  $("#startSessionHud").disabled = isActive;
  $("#stopSessionHud").disabled = !isActive;
  $("#startSession").disabled = isActive;
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
  $("#feedbackText").textContent = packet.feedback;
  renderFeedbackLog(packet.feedback_log || fallbackFeedbackLog(packet));
  speakFeedback(packet.feedback);
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
  const points = Object.fromEntries(packet.keypoints.map((p) => [p.name, { x: p.x * w, y: p.y * h }]));
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

$("#confirmDeleteYes").addEventListener("click", deletePendingSession);

$("#confirmDeleteNo").addEventListener("click", closeDeleteModal);

$("#confirmModal").addEventListener("click", (event) => {
  if (event.target.id === "confirmModal") closeDeleteModal();
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
