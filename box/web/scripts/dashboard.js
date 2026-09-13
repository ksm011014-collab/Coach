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
