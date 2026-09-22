(function () {
  "use strict";
  window.mountOperations = function ({ host, adapter, user, initialView = "dashboard", onNavigate, onRecording, onDownload } = {}) {
  const preview = !adapter;
  const U = OperationsUI;
  const e = U.escape;
  if (preview && new URLSearchParams(location.search).get("enable") !== "1") {
    host.innerHTML = `<main class="op-main"><h1>${t("APEX 개발용 미리보기")}</h1><p>${t("미리보기는 꺼져 있습니다. 합성 데이터만 사용하는 별도 화면입니다.")}</p><a href="/preview.html?enable=1">${t("개발용 샘플 데이터로 열기")}</a> · <a href="/">${t("실제 앱으로 돌아가기")}</a></main>`;
    return;
  }
  let actor = user || { id: "preview-owner", name: "샘플 관리자", role: "CENTER_OWNER" };
  const service = adapter || BoxingOperations.create({ enabled: true, storage: localStorage, actor: () => actor });
  let current = initialView === "memberships" ? "members" : initialView;
  let data;
  let generation = 0;
  let message = "";
  const views = {};
  const titles = { dashboard: t("운영 대시보드"), members: t("회원 관리"), memberships: t("회원권 관리"), attendance: t("방문 출석"), payments: t("수납 관리"), workouts: "운동 기록", home: "내 이용 현황", center: "센터 정보", staff: t("직원 프로필"), profile: t("내 프로필") };
  const navigation = () => actor.role === "MEMBER" ? ["home", "workouts", ...(preview ? ["profile"] : [])] : ["OWNER", "CENTER_OWNER", "COACH"].includes(actor.role) ? ["dashboard", "members", "attendance", "payments", "workouts", ...(preview ? ["center", "staff", "profile"] : [])] : !preview && actor.role === "PLATFORM_ADMIN" ? ["dashboard", "members", "workouts"] : [];
  const view = () => views[current] ||= { page: 1, search: "", status: "" };
  const own = rows => actor.role === "MEMBER" ? rows.filter(row => row.member_id === actor.id) : rows;
  function toolbar() {
    return `<header class="op-topbar"><strong class="op-brand">APEX</strong><span>${t("체육관 운영 · 프론트엔드 미리보기")}</span><div>${U.button("theme", t("테마 전환"))} <a href="/">${t("실제 앱으로 돌아가기")}</a></div></header><aside class="op-preview-banner" aria-label="${t("개발용 미리보기")}"><strong>${t("개발용 샘플 데이터")}</strong><label>${t("미리보기 역할")}<select id="previewRole"><option value="CENTER_OWNER" ${actor.role === "CENTER_OWNER" ? "selected" : ""}>${t("관리자")}</option><option value="COACH" ${actor.role === "COACH" ? "selected" : ""}>${t("코치")}</option><option value="MEMBER" ${actor.role === "MEMBER" ? "selected" : ""}>${t("회원")}</option></select></label><label>${t("기준일")}<input type="date" id="previewDate" value="${e(data?.referenceDate || "2026-09-18")}"></label>${U.button("reset", "샘플 초기화")}${U.button("fail-next", t("다음 요청 실패 재현"))}</aside>`;
  }
  function frame(content) {
    if (!preview) {
      host.innerHTML = `<section class="operations op-embedded"><p class="op-status" role="status">${e(t(message))}</p>${content}</section>`;
      return;
    }
    host.innerHTML = `${toolbar()}<div class="op-layout"><nav class="op-nav" aria-label="${t("관리 메뉴")}">${navigation().map(key => `<button data-action="navigate" data-id="${key}" ${current === key ? 'aria-current="page"' : ""}>${titles[key]}</button>`).join("")}</nav><main class="op-main" id="opMain"><div class="op-page-head"><div><h1>${titles[current]}</h1></div></div><p class="op-status" role="status">${e(t(message))}</p>${content}</main></div>`;
  }
  async function refresh({ saved = false } = {}) {
    const ticket = ++generation;
    if (!navigation().includes(current)) { frame(`<p role="alert">${t("이 화면에 접근할 권한이 없습니다.")}</p>`); return; }
    frame(`<p role="status" aria-busy="true">${t("불러오는 중…")}</p>`);
    try {
      const result = await service.snapshot(view().date);
      if (ticket !== generation) return;
      data = result;
      if (current === "attendance" && view().followToday) {
        view().date = data.referenceDate;
        view().month = data.referenceDate.slice(0, 7);
      }
      draw();
    } catch (error) {
      if (ticket === generation) frame(`<section role="alert"><p class="op-error">${saved ? t("저장은 완료됐지만 목록을 불러오지 못했습니다. 다시 저장하지 말고 조회를 재시도하세요. ") : ""}${e(t(error.message))}</p>${U.button("retry", t("다시 시도"))}</section>`);
    }
  }
  function go(key, filters = {}) {
    if (!navigation().includes(key)) { message = t("이 화면에 접근할 권한이 없습니다."); draw(); return; }
    current = key; views[key] = { page: 1, search: "", status: "", ...filters, ...(key === "attendance" ? { followToday: !filters.date || filters.date === data.referenceDate } : {}) }; message = "";
    if (key === "attendance" && !preview) refresh(); else draw();
    if (!preview) onNavigate?.(key);
    document.querySelector("#opMain h1")?.setAttribute("tabindex", "-1");
    document.querySelector("#opMain h1")?.focus();
  }
  function context() {
    return { data, view: view(), service, refresh, openForm, showDetail, canManageMoney: ["OWNER", "CENTER_OWNER"].includes(actor.role), preview };
  }
  function openForm(title, content, save, submitLabel) {
    return U.modal({ title, content, save, submitLabel, onSaved: async () => { message = preview ? t("개발용 데이터에 반영했습니다.") : t("변경을 완료했습니다."); await refresh({ saved: true }); } });
  }
  function showDetail(title, content) {
    const dialog = U.modal({ title, content, save: async () => {} });
    dialog.querySelector('[type="submit"]').remove();
    dialog.querySelector("footer [data-close]").textContent = t("닫기");
  }
  function draw() {
    if (!data) return;
    if (!navigation().includes(current)) { frame(`<p role="alert">${t("이 화면에 접근할 권한이 없습니다.")}</p>`); return; }
    const renderers = { ...screens(), ...(preview ? people() : {}), attendance: () => OperationsCommerce.attendance(context()), payments: () => OperationsCommerce.payments(context()) };
    frame(renderers[current]());
  }
  const screens = () => OperationsViews.create({ data, view, actor, preview, openForm, own, service });
  const people = () => OperationsPeople.create({ data, view, actor, service, openForm });
  host.addEventListener("click", async event => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const id = target.dataset.id;
    const action = target.dataset.action;
    try {
      const handlers = {
        ...OperationsCommerce.actions(context()), ...(preview ? people().actions : {}), navigate: key => go(key), retry: refresh,
        page: value => { view().page = Number(value); draw(); },
        "clear-filter": () => { views[current] = { page: 1, search: "", status: "" }; draw(); },
        member: value => go("members", { memberId: value }), "member-new": () => screens().memberForm(), "member-edit": value => screens().memberForm(value),
        "member-delete": value => openForm(t("회원 삭제 확인"), `<p>${t("회원 명단에서 제외하고 로그인 계정을 정지합니다. 기존 운동·수납·출석 이력은 보존합니다.")}</p>` + U.field("reason", t("삭제 사유"), "", { multiline: true, max: 500 }), (values, key) => service.deleteMember({ ...values, id: value }, key), t("회원 삭제 확정")),
        "member-back": () => go("members"), "member-tab": value => { view().tab = value; draw(); document.querySelector(`[data-action="member-tab"][data-id="${value}"]`)?.focus(); },
        "note-new": value => openForm(t("상담·코치 메모"), U.field("content", t("내용"), "", { multiline: true, max: 2000 }), (values, key) => service.addNote({ ...values, member_id: value }, key)),
        "dashboard-visits": () => go("attendance", { date: data.referenceDate }),
        "dashboard-active": () => go("members", { status: "ACTIVE" }),
        "dashboard-payments": () => go("payments", { from: `${data.referenceDate.slice(0, 7)}-01`, to: data.referenceDate }),
        "workout-detail": value => { const row = data.workouts.find(item => item.id === value); showDetail(t("운동 기록 상세"), `<p>${t("기록 ID")} ${e(row.id)}</p><p>${t("시작")} ${e(row.started_at)}</p><p>${t("종료")} ${e(row.ended_at || t("진행 중"))}</p><p>${preview ? t("샘플에는 실제 녹화 파일이 없습니다.") : row.has_recording ? t("이 장치에 녹화가 저장돼 있습니다.") : t("이 장치에 녹화 파일이 없습니다.")}</p>`); },
        "recording-play": value => onRecording?.(value),
        "recording-download": async value => { target.disabled = true; try { await onDownload?.(value); } finally { target.disabled = false; } },
        "workout-delete": value => openForm(t("운동 기록 삭제 확인"), `<p>${t("{target}를 삭제합니다. 되돌릴 수 없습니다.", { target: preview ? t("합성 운동 기록") : t("운동 기록과 이 장치의 녹화") })}</p><p>${t("기록 ID")} ${e(value)}</p>`, (_, key) => service.deleteWorkout({ id: value }, key), t("삭제 확정")),
        theme: () => { document.body.dataset.theme = document.body.dataset.theme === "light" ? "dark" : "light"; },
        "fail-next": () => { service.failNext(); message = t("다음 조회 또는 저장 요청을 실패시킵니다."); draw(); },
        reset: () => openForm(t("개발용 데이터 초기화"), `<p>${t("이 미리보기의 등록·변경 내역만 초기화합니다.")}</p>`, () => service.reset(), "초기화"),
      };
      if (handlers[action]) await handlers[action](id);
    } catch (error) { message = error.message; draw(); }
  });
  host.addEventListener("keydown", event => {
    if (!event.target.matches('[role="tab"]') || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
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
        current = role === "MEMBER" ? "home" : "dashboard"; message = ""; data = null;
        await refresh();
      }
      if (event.target.id === "previewDate") { await service.setReferenceDate(event.target.value); await refresh(); }
    } catch (error) { message = error.message; draw(); }
  });
  const refreshAttendance = () => {
    if (!host.isConnected) {
      clearInterval(attendanceTimer);
      window.removeEventListener("focus", refreshAttendance);
      return;
    }
    if (!preview && current === "attendance" && !document.hidden && !document.querySelector("dialog[open]") && !host.querySelector('[aria-busy="true"]') && !host.querySelector("input:focus,select:focus,textarea:focus")) refresh();
  };
  const attendanceTimer = preview ? null : setInterval(refreshAttendance, 60000);
  if (!preview) window.addEventListener("focus", refreshAttendance);
  refresh();
  return { refresh };
  };
  const host = document.querySelector("#operationsRoot");
  if (host) window.mountOperations({ host });
})();
