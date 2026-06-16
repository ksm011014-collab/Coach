const state = {
  token: localStorage.getItem("boxing_token"),
  user: null,
  profile: null,
  members: [],
  sessions: [],
  activeView: "coach",
  authMode: "owner",
  sidebarCollapsed: localStorage.getItem("sidebar_collapsed") === "true",
  socket: null,
  latestPose: null,
  cameraReady: false,
  usernameChecked: "",
};

const navItems = [
  ["coach", "실시간 코칭"],
  ["dashboard", "대시보드"],
  ["center", "센터 정보"],
  ["members", "회원 관리"],
  ["staff", "직원"],
  ["attendance", "출석"],
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
  };
  $("#viewTitle").textContent = titleMap[state.activeView] || "대시보드";
  if (state.activeView === "dashboard") renderDashboard();
  if (state.activeView === "center") renderCenterInfo();
  if (state.activeView === "members") renderMembers();
  if (state.activeView === "staff") renderStaff();
  if (state.activeView === "attendance") renderAttendance();
}

function renderDashboard() {
  $("#viewContent").innerHTML = [
    card("회원 수", `${state.members.length}명`, "관장 계정은 체육관 전체 회원을 확인합니다."),
    card("세션 수", `${state.sessions.length}건`, "실시간 코칭과 라벨링 대상 세션입니다."),
    card("현재 초점", "타격 · 가드", "가드 높이, 턱 보호, 회수 속도, 회전, 밸런스"),
    card("저장소", "SQLite DB", "회원가입, 세션, 라벨 데이터가 로컬 DB에 저장됩니다."),
  ].join("");
}

function renderMembers() {
  const rows = state.members.map((member, index) => {
    const joined = dateOffset(index * 17 + 12);
    const recent = dateOffset(index * 2 + 1);
    const plan = index % 2 === 0 ? "복싱 6개월" : "PT 10회";
    const status = index % 3 === 0 ? "재등록" : "정상";
    return `<tr>
      <td><span class="avatar">${member.name.slice(0, 1)}</span>${member.name}</td>
      <td>${member.phone || "-"}</td>
      <td>${member.birthdate || "-"}</td>
      <td><span class="badge">${member.gender || "-"}</span></td>
      <td>${recent}</td>
      <td>${plan}</td>
      <td>${status}</td>
      <td>${joined}</td>
    </tr>`;
  }).join("");
  $("#viewContent").innerHTML = `
    <section class="admin-board">
      <div class="admin-toolbar">
        <div class="segmented">
          <button class="active">전체 회원 ${state.members.length}</button>
          <button>운동회원</button>
          <button>만료 예정</button>
          <button>휴면</button>
        </div>
        <label class="search-box"><span>검색</span><input placeholder="이름, 아이디, 연락처 검색" /></label>
      </div>
      <div class="filter-row">
        <button>상태</button><button>가입일</button><button>성별</button><button>이용권</button><button>담당 직원</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>이름</th><th>전화번호</th><th>생년월일</th><th>성별</th><th>최근 출석일</th><th>이용권</th><th>상태</th><th>가입일</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8">등록된 회원이 없습니다.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="admin-actions">
        <button class="ghost">엑셀 다운로드</button>
        <button>회원 등록</button>
      </div>
    </section>`;
}

function renderCenterInfo() {
  $("#viewContent").innerHTML = `
    <section class="admin-board info-grid">
      ${card("센터명", "APEX Boxing Lab", "AI 동작·음성 교차 검증 기반 코칭 센터")}
      ${card("운영 시간", "06:00 - 23:00", "평일 기준, 주말은 별도 운영")}
      ${card("카메라", "cam_front_01", "실시간 코칭 기본 정면 카메라")}
      ${card("저장 정책", "키포인트 중심", "원본 영상은 로컬 보관, 리포트/라벨은 DB 저장")}
    </section>`;
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
  resetHud();
  const stream = await startCamera();
  if (!stream) return;
  const created = await api("/sessions", {
    method: "POST",
    body: JSON.stringify({ focus: "guard_and_strikes" }),
  });
  state.sessions.unshift(created.session);
  connectRealtime(created.session.id);
}

function connectRealtime(sessionId) {
  if (state.socket) state.socket.close();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${location.host}/realtime/session/${sessionId}?token=${encodeURIComponent(state.token)}`);
  state.socket.onmessage = (event) => {
    if (!state.cameraReady) return;
    const packet = JSON.parse(event.data);
    if (packet.error) {
      $("#cameraStatus").textContent = packet.status || "모션인식 오류";
      $("#feedbackText").textContent = packet.error;
      return;
    }
    state.latestPose = packet;
    updateHud(state.latestPose);
    drawSkeleton();
  };
  state.socket.onclose = () => {
    state.socket = null;
    if (state.cameraReady) {
      $("#cameraStatus").textContent = "실시간 연결 끊김";
    }
  };
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    $("#cameraPreview").srcObject = stream;
    $("#cameraFallback").classList.add("hidden");
    $("#cameraOffline").classList.add("hidden");
    state.cameraReady = true;
    return stream;
  } catch {
    state.cameraReady = false;
    if (state.socket) state.socket.close();
    $("#cameraFallback").classList.remove("hidden");
    $("#cameraOffline").classList.remove("hidden");
    resetHud();
    return null;
  }
}

function updateHud(packet) {
  $("#targetAction").textContent = packet.action;
  $("#scoreValue").textContent = packet.score;
  $("#confidenceValue").textContent = `confidence ${packet.confidence}`;
  $("#cameraStatus").textContent = `${packet.camera_id} · ${packet.view_angle} · ${packet.status}`;
  $("#feedbackText").textContent = packet.feedback;
  $("#metrics").innerHTML = Object.entries(packet.metrics)
    .map(([key, value]) => `<div class="metric"><small>${key}</small><br><strong>${value}</strong></div>`)
    .join("");
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
  if (!state.cameraReady || !state.latestPose) {
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
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  state.latestPose = null;
  $("#targetAction").textContent = "카메라 연결 대기";
  $("#scoreValue").textContent = "--";
  $("#confidenceValue").textContent = "confidence --";
  $("#cameraStatus").textContent = state.cameraReady ? "카메라 준비됨" : "카메라 연결 안됨";
  $("#feedbackText").textContent = "카메라가 연결되면 실시간 코칭을 시작할 수 있습니다.";
  $("#metrics").innerHTML = "";
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

$("#logoutButton").addEventListener("click", () => {
  localStorage.removeItem("boxing_token");
  location.reload();
});

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

$("#retryCamera").addEventListener("click", async () => {
  await startSession();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  drawSkeleton();
});

hydrate();
