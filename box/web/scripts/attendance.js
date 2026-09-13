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
