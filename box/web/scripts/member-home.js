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
          <div class="readonly-field"><span>Reach</span><strong>${memberReachLabel(profile)}</strong></div>
          <div class="readonly-field"><span>레벨</span><strong>${memberLevelLabel(profile)}</strong></div>
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
  ["height_cm", "weight_kg"].forEach((key) => {
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
