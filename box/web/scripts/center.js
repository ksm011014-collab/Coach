function renderCenterInfo() {
  const U = OperationsUI;
  const center = state.center;
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>${t("센터 기본 정보")}</h2><p>${t("로그인 센터:")} ${U.escape(state.user.center_name || center.name)} · ${t("코드")} ${U.escape(state.user.center_code || center.code)}</p><div id="centerShared"></div><form id="centerLocalForm" class="op-form">
    <fieldset class="op-duration"><legend>${t("기본 라운드 시간")}</legend><div class="op-duration-inputs">
      ${U.field("defaultSessionMinutes", t("분"), center.defaultSessionMinutes, { type: "number" })}
      ${U.field("defaultSessionSeconds", t("초"), center.defaultSessionSeconds, { type: "number" })}
    </div></fieldset>
    <p role="status" id="centerMessage">${U.escape(t(state.centerMessage))}</p><button class="op-primary">${t("이 장치에 저장")}</button>
  </form></section>`;
  const sharedHost = $("#centerShared");
  const owner = ["OWNER", "CENTER_OWNER"].includes(state.user.role);
  async function loadShared(saved = false) {
    sharedHost.innerHTML = `<p role="status" aria-busy="true">${t("불러오는 중…")}</p>`;
    try {
      const snapshot = await api("/operations");
      if (!sharedHost.isConnected) return;
      const shared = snapshot.center;
      if (!shared) throw new Error(t("센터 정보 서비스 연결 준비 중입니다."));
      const fields = [["phone", t("연락처"), 40], ["address", t("주소"), 300], ["weekday_hours", t("평일 운영시간"), 200], ["weekend_hours", t("주말 운영시간"), 200]];
      sharedHost.innerHTML = `<form class="op-form op-center-shared">${fields.map(([key, label, max]) => U.field(key, label, shared[key], { required: false, max, readonly: !owner })).join("")}<p role="status" class="op-center-message">${saved ? t("저장했습니다.") : ""}</p>${owner ? `<button class="op-primary">${t("센터 정보 저장")}</button>` : ""}</form>`;
      const form = sharedHost.querySelector("form");
      const requestId = crypto.randomUUID();
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = form.querySelector("button");
        if (!owner || button.disabled) return;
        button.disabled = true;
        const message = form.querySelector('[role="status"]');
        try {
          await api("/operations", { method: "POST", body: JSON.stringify({ operation: "center.save", request_id: requestId, input: { ...Object.fromEntries(new FormData(form)), id: shared.id, version: shared.version } }) });
          await loadShared(true);
        } catch (error) {
          message.textContent = error.message;
          button.disabled = false;
        }
      });
    } catch (error) {
      if (!sharedHost.isConnected) return;
      sharedHost.innerHTML = `<p role="alert">${saved ? t("저장은 완료됐지만 조회에 실패했습니다. ") : ""}${U.escape(error.message)}</p><button type="button">${t("다시 조회")}</button>`;
      sharedHost.querySelector("button").addEventListener("click", () => loadShared(saved));
    }
  }
  loadShared();
  $("#centerLocalForm").addEventListener("submit", event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      for (const key of ["defaultSessionMinutes", "defaultSessionSeconds"]) {
        body[key] = Number(body[key]);
        if (!Number.isSafeInteger(body[key]) || body[key] < 0) throw new Error(t("시간은 0 이상의 정수여야 합니다."));
      }
      if (body.defaultSessionSeconds > 59 || body.defaultSessionMinutes > 99 || body.defaultSessionMinutes * 60 + body.defaultSessionSeconds < 1) throw new Error(t("라운드 시간을 확인하세요. 최소 1초, 초 항목은 0~59입니다."));
      const updated = { ...state.center, ...body, defaultSessionDurationSeconds: body.defaultSessionMinutes * 60 + body.defaultSessionSeconds };
      writeJsonStorage(CENTER_KEY, updated);
      state.center = updated;
      state.centerMessage = t("이 장치에 저장했습니다.");
      $("#centerMessage").textContent = state.centerMessage;
    } catch (error) { $("#centerMessage").textContent = error.message; }
  });
}

function renderStaff() {
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>${t("직원 프로필")}</h2><p>${t("직원 업무 정보 서비스 연결 준비 중입니다.")}</p><a href="/preview.html?enable=1" target="_blank" rel="noopener">${t("개발용 관리 화면 열기")}</a></section>`;
}

function renderUnconnectedAttendance() {
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>${t("방문 출석")}</h2><p>${t("출석 서비스 연결 준비 중입니다. 운동 기록을 방문 출석으로 집계하지 않습니다.")}</p><p>${t("앱 운동은 운동 기록 메뉴에서 확인하세요.")}</p></section>`;
}
