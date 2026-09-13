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
      <td><span class="level-pill">${memberLevelLabel(member)}</span></td>
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
              <th>이름</th><th>나이</th><th>레벨</th><th>전화번호</th><th>등록일</th><th>만료일</th><th>최근 운동</th><th>관리</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8">조건에 맞는 회원이 없습니다.</td></tr>`}</tbody>
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
  document.querySelectorAll("[data-start-member-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedMemberId = button.dataset.startMemberSession;
      state.activeView = "coach";
      renderApp();
      await startSession();
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
        <button class="small-button" data-start-member-session="${member.id}">Start Coaching</button>
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
    <select name="training_level">
      ${memberLevelOptions(member.training_level)}
    </select>
    <div class="readonly-field"><span>Reach</span><strong>${memberReachLabel(member)}</strong></div>
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
    <select name="training_level">
      ${memberLevelOptions(1)}
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
    body.training_level = memberTrainingLevel(body);
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

function memberTrainingLevel(member) {
  const value = Number(member?.training_level || 1);
  return Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 1;
}

function memberLevelLabel(member) {
  return `LV ${memberTrainingLevel(member)}`;
}

function memberLevelOptions(selected = 1) {
  return [1, 2, 3, 4, 5]
    .map((level) => profileOption(String(level), `LV ${level}`, String(memberTrainingLevel({ training_level: selected }))))
    .join("");
}

function memberReachLabel(member) {
  if (Number(member?.reach_cm || 0) > 0) {
    return `${member.reach_cm}cm`;
  }
  return "-";

  const calibration = memberCalibration(member);
  if (calibration?.estimated_reach_cm) {
    return `${calibration.estimated_reach_cm}cm auto`;
  }
  if (Number(member?.reach_cm || 0) > 0 && isMemberCalibrated(member)) {
    return `${member.reach_cm}cm auto`;
  }
  return "첫 보정 필요";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function updateMemberFromForm(event) {
  event.preventDefault();
  const member = state.members.find((item) => item.id === state.editingMemberId);
  if (!member) return;
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  ["height_cm", "weight_kg", "training_level"].forEach((key) => {
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
