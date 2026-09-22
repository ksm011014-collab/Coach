function openAccountModal() {
  const profile = state.profile;
  if (!profile?.id) { setSettingsMessage(t("수정할 프로필이 없습니다.")); renderSettings(); return; }
  const U = OperationsUI;
  const F = U.field;
  U.modal({
    title: t("내 프로필 수정"),
    content: F("name", t("이름"), profile.name || state.user.name, { max: 100 }) + F("phone", t("전화번호"), profile.phone, { required: false, max: 30 }) + F("gender", t("성별"), profile.gender, { required: false, options: [["", t("선택 안 함")], ["male", t("남성")], ["female", t("여성")], ["other", t("기타")]] }) + F("height_cm", t("키 (cm)"), profile.height_cm || "", { type: "number", required: false }) + F("weight_kg", t("몸무게 (kg)"), profile.weight_kg || "", { type: "number", required: false }) + F("stance", t("스탠스"), profile.stance || "orthodox", { options: [["orthodox", t("오소독스")], ["southpaw", t("사우스포")]] }) + F("injury_note", t("주의 사항"), profile.injury_note, { multiline: true, required: false, max: 2000 }),
    save: async values => {
      for (const key of ["height_cm", "weight_kg"]) {
        if (values[key] === "") delete values[key];
        else values[key] = Number(values[key]);
      }
      const result = await api(`/members/${encodeURIComponent(profile.id)}`, { method: "PATCH", body: JSON.stringify(values) });
      state.profile = result.member;
      state.user.name = result.member.name || state.user.name;
    },
    onSaved: () => { setSettingsMessage(t("프로필을 수정했습니다.")); renderSettings(); },
  });
}

async function logout() {
  if (state.sessionBusy) return;
  if (state.activeSessionId) {
    await stopSession();
    if (state.activeSessionId) return;
  }
  stopCamera();
  try { await logoutAuthSession(); }
  catch (error) { showSessionError(new Error(t("서버 로그아웃 실패: {error}. 다시 시도해주세요.", { error: error.message }))); return; }
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
