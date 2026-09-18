(function () {
  "use strict";
  window.mountOperations = function ({ host, adapter, user, initialView = "dashboard", onNavigate, onRecording } = {}) {
  const preview = !adapter;
  const U = OperationsUI;
  const e = U.escape;
  if (preview && new URLSearchParams(location.search).get("enable") !== "1") {
    host.innerHTML = `<main class="op-main"><h1>APEX 개발용 미리보기</h1><p>미리보기는 꺼져 있습니다. 합성 데이터만 사용하는 별도 화면입니다.</p><a href="/preview.html?enable=1">개발용 샘플 데이터로 열기</a> · <a href="/">실제 앱으로 돌아가기</a></main>`;
    return;
  }
  let actor = user || { id: "preview-owner", name: "샘플 관리자", role: "CENTER_OWNER" };
  const service = adapter || BoxingOperations.create({ enabled: true, storage: localStorage, actor: () => actor });
  let current = initialView;
  let data;
  let generation = 0;
  let message = "";
  const views = {};
  const titles = { dashboard: "운영 대시보드", members: "회원 관리", memberships: "회원권 관리", attendance: "방문 출석", payments: "수납 관리", workouts: "운동 기록", home: "내 이용 현황" };
  const navigation = () => actor.role === "MEMBER" ? ["home", "workouts"] : ["dashboard", "members", "memberships", "attendance", "payments", "workouts"];
  const view = () => views[current] ||= { page: 1, search: "", status: "" };
  const own = rows => actor.role === "MEMBER" ? rows.filter(row => row.member_id === actor.id) : rows;
  function toolbar() {
    return `<header class="op-topbar"><strong class="op-brand">APEX</strong><span>체육관 운영 · 프론트엔드 미리보기</span><div>${U.button("theme", "테마 전환")} <a href="/">실제 앱으로 돌아가기</a></div></header><aside class="op-preview-banner" aria-label="개발용 미리보기"><strong>개발용 샘플 데이터</strong><label>미리보기 역할<select id="previewRole"><option value="CENTER_OWNER" ${actor.role === "CENTER_OWNER" ? "selected" : ""}>관리자</option><option value="COACH" ${actor.role === "COACH" ? "selected" : ""}>코치</option><option value="MEMBER" ${actor.role === "MEMBER" ? "selected" : ""}>회원</option></select></label><label>기준일<input type="date" id="previewDate" value="${e(data?.referenceDate || "2026-09-18")}"></label>${U.button("reset", "샘플 초기화")}${U.button("fail-next", "다음 요청 실패 재현")}</aside>`;
  }
  function frame(content) {
    if (!preview) {
      host.innerHTML = `<section class="operations op-embedded"><div class="op-page-head"><small>실제 연결: 회원·운동 기록 · 회원권·출석·수납·메모는 연결 준비 중</small>${U.button("retry", "새로고침")}</div><p class="op-status" role="status">${e(message)}</p>${content}</section>`;
      return;
    }
    host.innerHTML = `${toolbar()}<div class="op-layout"><nav class="op-nav" aria-label="관리 메뉴">${navigation().map(key => `<button data-action="navigate" data-id="${key}" ${current === key ? 'aria-current="page"' : ""}>${titles[key]}</button>`).join("")}</nav><main class="op-main" id="opMain"><div class="op-page-head"><div><h1>${titles[current]}</h1><small>합성 센터 · 실제 데이터와 연결되지 않음</small></div></div><p class="op-status" role="status">${e(message)}</p>${content}</main></div>`;
  }
  async function refresh() {
    const ticket = ++generation;
    frame('<p role="status" aria-busy="true">불러오는 중…</p>');
    try {
      const result = await service.snapshot();
      if (ticket !== generation) return;
      data = result;
      draw();
    } catch (error) {
      if (ticket === generation) frame(`<section role="alert"><p class="op-error">${e(error.message)}</p>${U.button("retry", "다시 시도")}</section>`);
    }
  }
  function go(key, filters = {}) {
    if (!navigation().includes(key)) { message = "이 화면에 접근할 권한이 없습니다."; draw(); return; }
    current = key; views[key] = { page: 1, search: "", status: "", ...filters }; message = ""; draw();
    if (!preview) onNavigate?.(key);
    document.querySelector("#opMain h1")?.setAttribute("tabindex", "-1");
    document.querySelector("#opMain h1")?.focus();
  }
  function context() {
    return { data, view: view(), service, refresh, openForm, showDetail, canManageMoney: ["OWNER", "CENTER_OWNER"].includes(actor.role), preview };
  }
  function openForm(title, content, save, submitLabel) {
    return U.modal({ title, content, save, submitLabel, onSaved: async () => { message = preview ? "개발용 데이터에 저장했습니다." : "저장했습니다."; await refresh(); } });
  }
  function showDetail(title, content) {
    const dialog = U.modal({ title, content, save: async () => {} });
    dialog.querySelector('[type="submit"]').remove();
    dialog.querySelector("footer [data-close]").textContent = "닫기";
  }
  function draw() {
    if (!data) return;
    const renderers = { dashboard, members, memberships: () => OperationsCommerce.memberships(context()), attendance: () => OperationsCommerce.attendance(context()), payments: () => OperationsCommerce.payments(context()), workouts, home };
    frame(renderers[current]());
  }
  function dashboard() {
    if (!preview) return `<section class="op-section"><h2>운영 데이터 연결 준비 중</h2><p>방문 출석·회원권·수납 API가 연결되면 오늘 출석, 만료 예정, 미납 내역을 표시합니다.</p><div class="op-metrics"><article class="op-card"><small>등록 회원</small><h2>${data.members.length}명</h2></article><article class="op-card"><small>운동 기록</small><h2>${data.workouts.length}건</h2></article></div>${U.button("navigate", "회원 관리", "members")}${U.button("navigate", "운동 기록", "workouts")}</section>`;
    const day = data.referenceDate;
    const threshold = new Date(`${day}T00:00:00Z`); threshold.setUTCDate(threshold.getUTCDate() + 7);
    const end = threshold.toISOString().slice(0, 10);
    const active = data.passes.filter(row => U.passStatus(row, day) === "ACTIVE");
    const expiring = active.filter(row => row.end_on <= end);
    const visits = data.attendance.filter(row => row.visited_on === day && row.status === "PRESENT");
    const payments = data.payments.filter(row => row.paid_on?.slice(0, 7) === day.slice(0, 7) && ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes(row.status));
    const collected = payments.reduce((sum, row) => sum + row.amount - row.adjustments.reduce((total, item) => total + item.amount, 0), 0);
    const absent = data.members.filter(member => {
      const last = data.attendance.filter(row => row.member_id === member.id && row.status === "PRESENT" && row.visited_on <= day).map(row => row.visited_on).sort().at(-1) || member.joined_on;
      return (new Date(`${day}T00:00:00Z`) - new Date(`${last}T00:00:00Z`)) / 86400000 >= 30;
    });
    const metric = (title, value, hint, action, id) => `<button class="op-metric" data-action="${action}" data-id="${e(id)}"><small>${title}</small><strong>${value}</strong><small>${e(hint)}</small></button>`;
    const list = (title, rows) => `<section class="op-section"><h2>${title}</h2>${U.table(["회원", "확인 내용"], rows)}</section>`;
    return `<div class="op-metrics">${metric("오늘 방문", `${visits.length}명`, day, "dashboard-visits", "")}${metric("유효 이용권 보유", `${new Set(active.map(row => row.member_id)).size}명`, "기준일에 유효한 회원권 · 회원 중복 제외", "dashboard-active", "")}${metric("7일 내 만료", `${expiring.length}건`, `${day} ~ ${end}`, "dashboard-expiring", "")}${metric("이번 달 수납 잔액", U.money(collected), `${day.slice(0, 7)} 수납분에서 입력된 환불 차감`, "dashboard-payments", "")}</div>
      ${list("오늘 출석 회원", visits.map(row => [OperationsCommerce.memberCell(data, row.member_id), e(row.reason)]))}<div class="op-columns">${list("만료 예정", expiring.map(row => [OperationsCommerce.memberCell(data, row.member_id), e(row.end_on)]))}${list("장기 미방문", absent.map(row => [OperationsCommerce.memberCell(data, row.id), "방문 또는 가입 이후 30일 이상 · 미리보기 기준"]))}${list("미납 확인", data.payments.filter(row => row.status === "UNPAID").map(row => [OperationsCommerce.memberCell(data, row.member_id), U.button("payment-detail", U.money(row.amount), row.id, "op-link")]))}<section class="op-section"><h2>최근 등록·변경·수납 활동</h2>${U.table(["종류", "담당자", "시각"], data.activities.slice(0, 8).map(row => [e(activityLabel(row.operation)), e(row.actor), e(row.created_at)]), "샘플에서 등록·변경하면 활동이 표시됩니다.")}</section></div>`;
  }
  function activityLabel(operation) { return ({ "member.save": "회원 등록·수정", "product.save": "상품 등록·수정", "pass.assign": "이용권 부여", "pass.change": "회원권 변경", "attendance.mark": "방문 출석", "attendance.cancel": "출석 취소", "payment.register": "수납 등록", "payment.adjust": "취소·환불 기록", "note.add": "상담 메모" })[operation] || operation; }
  function members() {
    const selected = data.members.find(row => row.id === view().memberId);
    if (selected) return memberDetail(selected);
    const status = member => {
      const passes = data.passes.filter(row => row.member_id === member.id);
      return !preview ? "UNAVAILABLE" : passes.some(row => U.passStatus(row, data.referenceDate) === "ACTIVE") ? "ACTIVE" : passes.some(row => U.passStatus(row, data.referenceDate) === "PAUSED") ? "PAUSED" : passes.length ? "EXPIRED" : "NONE";
    };
    const rows = data.members.filter(row => !view().status || status(row) === view().status);
    const result = U.filterRows(rows, { search: view().search, page: view().page, text: row => `${row.name} ${row.phone}`, compare: (a, b) => view().sort === "joined" ? b.joined_on.localeCompare(a.joined_on) : a.name.localeCompare(b.name, "ko") });
    return `<div class="op-page-head"><p class="op-muted">회원권 이용 상태와 로그인 계정 상태를 구분합니다.</p>${U.button("member-new", "회원 등록", "", "op-primary")}</div>${OperationsCommerce.filters(view(), U.field("status", "회원권 상태", view().status, { required: false, options: [["", "전체"], ["ACTIVE", "유효"], ["PAUSED", "휴회"], ["EXPIRED", "만료·종료"], ["NONE", "이용권 없음"]] }) + U.field("sort", "정렬", view().sort, { options: [["name", "이름순"], ["joined", "최근 등록순"]] }))}${U.table(["회원", "연락처", "회원권", "로그인 계정", "등록일"], result.rows.map(row => [OperationsCommerce.memberCell(data, row.id), e(row.phone), status(row) === "NONE" ? "이용권 없음" : U.badge(status(row)), U.badge(row.account_status), e(row.joined_on)]), view().search ? "검색 결과가 없습니다." : "등록된 회원이 없습니다.")}${U.pagination(result)}`;
  }
  function memberDetail(member) {
    const tab = view().tab || "basic";
    const tabs = [["basic", "기본 정보"], ["passes", "회원권"], ["records", "출석·운동"], ["payments", "수납"], ["notes", "상담·코치 메모"]];
    let content = "";
    if (tab === "basic") content = `<section class="op-card"><h2>${e(member.name)}</h2><p>${e(member.phone)}</p><p>등록일 ${e(member.joined_on)} · 로그인 계정 ${U.badge(member.account_status)}</p>${U.button("member-edit", "기본 정보 수정", member.id)}</section>`;
    if (tab === "passes") content = `${U.button("pass-new", "이용권 부여", member.id)}${U.table(["상품", "기간", "잔여", "상태", "이력"], data.passes.filter(row => row.member_id === member.id).map(row => [e(data.products.find(product => product.id === row.product_id)?.name), `${e(row.start_on)} ~ ${e(row.end_on)}`, row.remaining === null ? "기간권" : `${row.remaining}회`, U.badge(U.passStatus(row, data.referenceDate)), U.button("pass-detail", "변경·이력", row.id)]))}`;
    if (tab === "records") content = `<h2>방문 출석</h2>${U.table(["날짜", "상태", "사유"], data.attendance.filter(row => row.member_id === member.id).map(row => [e(row.visited_on), U.badge(row.status), e(row.reason)]))}<h2>앱 운동 세션</h2>${workoutTable(data.workouts.filter(row => row.member_id === member.id))}`;
    if (tab === "payments") content = `${actor.role === "CENTER_OWNER" ? U.button("payment-new", "수납 등록", member.id) : ""}${U.table(["수납일", "금액", "상태", "내역"], data.payments.filter(row => row.member_id === member.id).map(row => [e(row.paid_on || "미수납"), U.money(row.amount), U.badge(row.status), U.button("payment-detail", "내역 보기", row.id)]))}`;
    if (tab === "notes") content = `${U.button("note-new", "메모 작성", member.id)}${U.table(["작성자", "작성 시각", "내용"], data.notes.filter(row => row.member_id === member.id).map(row => [e(row.author_name), e(row.created_at), `<span style="white-space:pre-wrap">${e(row.content)}</span>`]))}`;
    return `<div class="op-page-head">${U.button("member-back", "회원 목록")}<h2>${e(member.name)}</h2></div><div class="op-tabs" role="tablist" aria-label="회원 상세">${tabs.map(([key, title]) => `<button role="tab" aria-selected="${tab === key}" data-action="member-tab" data-id="${key}">${title}</button>`).join("")}</div><section role="tabpanel">${content}</section>`;
  }
  function workoutTable(rows) {
    return U.table(["회원", "시작", "종료", "상태", "상세"], rows.map(row => [e(data.members.find(member => member.id === row.member_id)?.name), e(row.started_at), e(row.ended_at || "—"), row.ended_at ? "완료" : "진행 중", U.button("workout-detail", "기록 상세", row.id)]), "저장된 운동 기록이 없습니다. 방문 출석은 별도 화면에서 확인하세요.");
  }
  function workouts() {
    const rows = own(data.workouts).filter(row => (!view().status || (row.ended_at ? "COMPLETE" : "OPEN") === view().status) && (!view().from || row.started_at.slice(0, 10) >= view().from) && (!view().to || row.started_at.slice(0, 10) <= view().to));
    const result = U.filterRows(rows, { search: view().search, page: view().page, text: row => data.members.find(member => member.id === row.member_id)?.name, compare: (a, b) => view().sort === "oldest" ? a.started_at.localeCompare(b.started_at) : b.started_at.localeCompare(a.started_at) });
    return `${OperationsCommerce.filters(view(), U.field("from", "시작일", view().from, { type: "date", required: false }) + U.field("to", "종료일", view().to, { type: "date", required: false }) + U.field("status", "완료 상태", view().status, { required: false, options: [["", "전체"], ["COMPLETE", "완료"], ["OPEN", "진행 중"]] }) + U.field("sort", "정렬", view().sort, { options: [["newest", "최신순"], ["oldest", "오래된순"]] }))}${workoutTable(result.rows)}${U.pagination(result)}<p class="op-muted">분석 엔진 준비 중 · 모션 점수와 AI 피드백을 생성하지 않습니다.</p>`;
  }
  function home() {
    if (!preview) return `<section class="op-section"><h2>내 이용 현황</h2><p>이용권·방문 출석·수납 내역은 백엔드 연결 준비 중입니다.</p><p>운동 세션 ${data.workouts.length}건 · 방문 출석과 별도 집계</p>${U.button("navigate", "내 운동 기록 보기", "workouts")}</section>`;
    const passes = own(data.passes);
    const visits = own(data.attendance).filter(row => row.status === "PRESENT");
    return `<section class="op-section"><h2>내 이용권</h2>${U.table(["상품", "기간", "잔여 횟수", "상태"], passes.map(row => [e(data.products.find(product => product.id === row.product_id)?.name), `${e(row.start_on)} ~ ${e(row.end_on)}`, row.remaining === null ? "기간권" : `${row.remaining}회`, U.badge(U.passStatus(row, data.referenceDate))]))}</section><div class="op-columns"><section><h2>최근 방문 출석</h2>${U.table(["방문일", "상태"], visits.slice().sort((a, b) => b.visited_on.localeCompare(a.visited_on)).slice(0, 5).map(row => [e(row.visited_on), "출석"]))}</section><section><h2>앱 운동 기록</h2><p>${data.workouts.length}건 저장 · 방문 출석과 별도 집계</p>${U.button("navigate", "운동 기록 보기", "workouts")}</section></div><section class="op-section"><h2>내 수납 내역</h2>${U.table(["수납일", "금액", "상태", "상세"], own(data.payments).map(row => [e(row.paid_on || "미수납"), U.money(row.amount), U.badge(row.status), U.button("payment-detail", "내역 보기", row.id)]))}</section>`;
  }
  function memberForm(id) {
    const row = data.members.find(member => member.id === id);
    const identity = !preview && !row ? U.field("username", "로그인 아이디") + U.field("email", "이메일", "", { type: "email" }) + U.field("password", "비밀번호 (특수문자 포함 8자 이상)", "", { type: "password", max: 256 }) + U.field("password_confirm", "비밀번호 확인", "", { type: "password", max: 256 }) : "";
    const profile = !preview ? U.field("birthdate", "생년월일", row?.birthdate, { type: "date", required: false }) + U.field("gender", "성별", row?.gender, { required: false, options: [["", "선택 안 함"], ["male", "남성"], ["female", "여성"], ["other", "기타"]] }) + U.field("height_cm", "키 (cm)", row?.height_cm || "", { type: "number", required: false }) + U.field("weight_kg", "체중 (kg)", row?.weight_kg || "", { type: "number", required: false }) + U.field("training_level", "훈련 단계", row?.training_level || 1, { type: "number", min: 1 }) + U.field("stance", "스탠스", row?.stance || "orthodox", { options: [["orthodox", "오소독스"], ["southpaw", "사우스포"]] }) + U.field("injury_note", "주의 사항", row?.injury_note, { multiline: true, max: 2000, required: false }) : "";
    openForm(row ? "회원 정보 수정" : "회원 등록", identity + U.field("name", "이름", row?.name, { max: 100 }) + U.field("phone", "연락처", row?.phone, { type: "tel", max: 30, required: preview }) + profile + (preview ? "<p>샘플 회원 프로필만 저장합니다. 로그인 계정은 생성하지 않습니다.</p>" : ""), (values, key) => service.saveMember({ ...values, id: row?.id }, key));
  }
  host.addEventListener("click", async event => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const id = target.dataset.id;
    const action = target.dataset.action;
    try {
      const handlers = {
        ...OperationsCommerce.actions(context()), navigate: key => go(key), retry: refresh,
        page: value => { view().page = Number(value); draw(); },
        "clear-filter": () => { views[current] = { page: 1, search: "", status: "" }; draw(); },
        member: value => go("members", { memberId: value }), "member-new": () => memberForm(), "member-edit": memberForm,
        "member-back": () => go("members"), "member-tab": value => { view().tab = value; draw(); document.querySelector(`[data-action="member-tab"][data-id="${value}"]`)?.focus(); },
        "note-new": value => openForm("상담·코치 메모", U.field("content", "내용", "", { multiline: true, max: 2000 }), (values, key) => service.addNote({ ...values, member_id: value }, key)),
        "dashboard-visits": () => go("attendance", { date: data.referenceDate }),
        "dashboard-active": () => go("members", { status: "ACTIVE" }),
        "dashboard-expiring": () => { const date = new Date(`${data.referenceDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 7); go("memberships", { status: "ACTIVE", expiresBy: date.toISOString().slice(0, 10) }); },
        "dashboard-payments": () => go("payments", { from: `${data.referenceDate.slice(0, 7)}-01`, to: data.referenceDate }),
        "workout-detail": value => { const row = data.workouts.find(item => item.id === value); const dialog = U.modal({ title: "운동 기록 상세", content: `<p>기록 ID ${e(row.id)}</p><p>시작 ${e(row.started_at)}</p><p>종료 ${e(row.ended_at || "진행 중")}</p><p>${preview ? "샘플에는 실제 녹화 파일이 없습니다." : row.has_recording ? "이 장치에 녹화가 저장돼 있습니다." : "이 장치에 녹화 파일이 없습니다."}</p>`, submitLabel: row.has_recording ? "녹화 보기" : "닫기", save: async () => { if (row.has_recording) await onRecording?.(row.id); } }); dialog.querySelector("footer [data-close]").textContent = "닫기"; },
        theme: () => { document.body.dataset.theme = document.body.dataset.theme === "light" ? "dark" : "light"; },
        "fail-next": () => { service.failNext(); message = "다음 조회 또는 저장 요청을 실패시킵니다."; draw(); },
        reset: () => openForm("개발용 데이터 초기화", "<p>이 미리보기의 등록·변경 내역만 초기화합니다.</p>", () => service.reset(), "초기화"),
      };
      if (handlers[action]) await handlers[action](id);
    } catch (error) { message = error.message; draw(); }
  });
  host.addEventListener("submit", event => {
    if (!event.target.matches("[data-filter]")) return;
    event.preventDefault();
    Object.assign(view(), Object.fromEntries(new FormData(event.target)), { page: 1 });
    draw(); document.querySelector('[data-filter] input[name="search"]')?.focus();
  });
  host.addEventListener("change", async event => {
    try {
      if (event.target.id === "previewRole") {
        const role = event.target.value;
        actor = { role, id: role === "MEMBER" ? "preview-member-1" : role === "COACH" ? "preview-coach" : "preview-owner", name: role === "MEMBER" ? "샘플 김하나" : role === "COACH" ? "샘플 코치" : "샘플 관리자" };
        current = role === "MEMBER" ? "home" : "dashboard"; message = "";
        await refresh();
      }
      if (event.target.id === "previewDate") { await service.setReferenceDate(event.target.value); await refresh(); }
    } catch (error) { message = error.message; draw(); }
  });
  refresh();
  return { refresh };
  };
  const host = document.querySelector("#operationsRoot");
  if (host) window.mountOperations({ host });
})();
