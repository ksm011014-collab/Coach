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

async function logout() {
  await clearAuthSession();
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
  const saved = readJsonStorage(CENTER_KEY, {});
  return normalizeCenterProfile({ ...defaultCenterProfile(), ...saved }, saved);
}

function saveCenterProfile() {
  state.center = normalizeCenterProfile(state.center);
  writeJsonStorage(CENTER_KEY, state.center);
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
  return readJsonStorage(STAFF_KEY, null) || defaultStaff();
}

function saveStaff() {
  writeJsonStorage(STAFF_KEY, state.staff);
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
