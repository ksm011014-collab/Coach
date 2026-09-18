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
  if (state.sessionBusy) return;
  if (state.activeSessionId) {
    await stopSession();
    if (state.activeSessionId) return;
  }
  stopCamera();
  try { await logoutAuthSession(); }
  catch (error) { showSessionError(new Error(`서버 로그아웃 실패: ${error.message}. 다시 시도해주세요.`)); return; }
  location.reload();
}

function defaultCenterProfile() {
  return {
    name: "",
    owner: "",
    code: "",
    phone: "",
    address: "",
    weekdayHours: "",
    weekendHours: "",
    ringCount: 0,
    bagCount: 0,
    defaultSessionMinutes: 3,
    defaultSessionSeconds: 0,
    defaultSessionDurationSeconds: 180,
    monthlyMembershipPrice: 0,
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
