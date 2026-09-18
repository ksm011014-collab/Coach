function renderCenterInfo() {
  const U = OperationsUI;
  const center = state.center;
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>센터 기본 정보</h2><p>로그인 센터: ${U.escape(state.user.center_name || center.name)} · 코드 ${U.escape(state.user.center_code || center.code)}</p><p class="op-muted">아래 정보는 이 브라우저의 설정입니다. 중앙 센터 계정이나 수납 내역을 변경하지 않습니다.</p><form id="centerLocalForm" class="op-form">
    ${U.field("phone", "연락처", center.phone, { required: false, type: "tel" })}
    ${U.field("address", "주소", center.address, { required: false })}
    ${U.field("weekdayHours", "평일 운영시간", center.weekdayHours, { required: false })}
    ${U.field("weekendHours", "주말 운영시간", center.weekendHours, { required: false })}
    ${U.field("ringCount", "링 수", center.ringCount, { type: "number" })}
    ${U.field("bagCount", "샌드백 수", center.bagCount, { type: "number" })}
    ${U.field("defaultSessionMinutes", "기본 라운드 시간 (분)", center.defaultSessionMinutes, { type: "number" })}
    ${U.field("defaultSessionSeconds", "기본 라운드 시간 (초, 0~59)", center.defaultSessionSeconds, { type: "number" })}
    <p role="status" id="centerMessage">${U.escape(state.centerMessage)}</p><button class="op-primary">이 장치에 저장</button>
  </form></section>`;
  $("#centerLocalForm").addEventListener("submit", event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      for (const key of ["ringCount", "bagCount", "defaultSessionMinutes", "defaultSessionSeconds"]) {
        body[key] = Number(body[key]);
        if (!Number.isSafeInteger(body[key]) || body[key] < 0) throw new Error("수량과 시간은 0 이상의 정수여야 합니다.");
      }
      if (body.defaultSessionSeconds > 59 || body.defaultSessionMinutes > 99 || body.defaultSessionMinutes * 60 + body.defaultSessionSeconds < 1) throw new Error("라운드 시간을 확인하세요. 최소 1초, 초 항목은 0~59입니다.");
      const updated = { ...state.center, ...body, defaultSessionDurationSeconds: body.defaultSessionMinutes * 60 + body.defaultSessionSeconds };
      writeJsonStorage(CENTER_KEY, updated);
      state.center = updated;
      state.centerMessage = "이 장치에 저장했습니다.";
      $("#centerMessage").textContent = state.centerMessage;
    } catch (error) { $("#centerMessage").textContent = error.message; }
  });
}

function renderStaff() {
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>직원 프로필</h2><p>직원 업무 정보 서비스 연결 준비 중입니다.</p><p>직원 프로필은 로그인 계정 권한과 별개입니다. 계정 권한은 권한 관리 화면에서 확인하세요.</p><p class="op-muted">과거 브라우저에 저장된 직원 목록은 보존하지만, 합성 기본 직원과 실제 직원을 구분할 수 없어 운영 목록에 표시하지 않습니다.</p><a href="/preview.html?enable=1" target="_blank" rel="noopener">개발용 관리 화면 열기</a></section>`;
}

function renderUnconnectedAttendance() {
  $("#viewContent").innerHTML = `<section class="operations op-embedded"><h2>방문 출석</h2><p>출석 서비스 연결 준비 중입니다. 운동 기록을 방문 출석으로 집계하지 않습니다.</p><p>앱 운동은 운동 기록 메뉴에서 확인하세요.</p></section>`;
}
