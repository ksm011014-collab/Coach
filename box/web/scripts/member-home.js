function renderMemberProfile() {
  const profile = state.profile || {};
  const U = OperationsUI;
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>${t("내 프로필")}</h2><p>${U.escape(state.user.username)} · ${U.escape(state.user.email || t("이메일 없음"))}</p><form id="memberProfileForm" class="op-form">
    ${U.field("name", t("이름"), profile.name || state.user.name, { max: 100 })}
    ${U.field("phone", t("연락처"), profile.phone, { type: "tel", required: false })}
    ${U.field("birthdate", t("생년월일"), profile.birthdate, { type: "date", required: false })}
    ${U.field("gender", t("성별"), profile.gender, { required: false, options: [["", t("선택 안 함")], ["male", t("남성")], ["female", t("여성")], ["other", t("기타")]] })}
    ${U.field("height_cm", t("키 (cm)"), profile.height_cm || "", { type: "number", required: false })}
    ${U.field("weight_kg", t("체중 (kg)"), profile.weight_kg || "", { type: "number", required: false })}
    <p>${U.escape(t("리치 {reach} · 훈련 단계 {level} (코치 관리)", { reach: memberReachLabel(profile), level: memberLevelLabel(profile) }))}</p>
    ${U.field("stance", t("스탠스"), profile.stance || "orthodox", { options: [["orthodox", t("오소독스")], ["southpaw", t("사우스포")]] })}
    ${U.field("injury_note", t("부상·주의 사항"), profile.injury_note, { multiline: true, max: 2000, required: false })}
    <p id="memberProfileMessage" role="status"></p><div class="op-toolbar"><button class="op-primary">${t("정보 저장")}</button></div>
  </form></section>`;
  $("#memberProfileForm").addEventListener("submit", saveMemberProfile);
}

async function saveMemberProfile(event) {
  event.preventDefault();
  if (event.currentTarget.dataset.busy) return;
  const element = event.currentTarget;
  const form = new FormData(element);
  element.dataset.busy = "true";
  element.querySelectorAll("button").forEach(button => { button.disabled = true; });
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
    $("#memberProfileMessage").textContent = t("정보를 저장했습니다.");
    $("#userName").textContent = `${state.user.name} · ${t("회원")}`;
  } catch (error) {
    $("#memberProfileMessage").textContent = error.message;
  } finally {
    delete element.dataset.busy;
    element.querySelectorAll("button").forEach(button => { button.disabled = false; });
  }
}

async function refreshMemberProfile() {
  try {
    const me = await api("/me");
    state.user = me.user;
    state.profile = me.profile;
    renderMemberProfile();
  } catch (error) { $("#memberProfileMessage").textContent = error.message; }
}
