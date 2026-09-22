(function (root) {
  "use strict";
  const U = root.OperationsUI;
  const e = U.escape;
  const options = values => values.map(value => [value, U.label(value)]);
  const memberOptions = data => data.members.filter(row => !row.deleted_on).map(row => [row.id, row.name]);
  const productOptions = data => data.products.map(row => [row.id, row.name]);
  function name(data, collection, id) { return data[collection].find(row => row.id === id)?.name || t("확인 불가"); }
  function memberCell(data, id) { return U.button("member", name(data, "members", id), id, "op-link"); }
  function filters(view, extra = "", searchLabel = t("회원 이름·연락처 검색"), actions = "") {
    return `<form class="op-toolbar" data-filter>${U.field("search", searchLabel, view.search, { required: false })}${extra}<button type="submit">${t("조회")}</button>${U.button("clear-filter", t("초기화"))}${actions ? `<span class="op-toolbar-end">${actions}</span>` : ""}</form>`;
  }
  function filtered(data, rows, view, toText) {
    return U.filterRows(rows, { search: view.search, page: view.page, text: toText || (row => `${name(data, "members", row.member_id)} ${data.members.find(member => member.id === row.member_id)?.phone || ""}`), compare: (a, b) => String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)) });
  }
  function products({ data, canManageMoney }) {
    return `<section class="op-section"><div class="op-page-head"><h2>${t("회원권 상품")}</h2>${canManageMoney ? U.button("product-new", t("상품 등록"), "", "op-primary") : ""}</div>${U.table([t("상품명"), t("유형"), t("유효 기간"), t("횟수"), t("판매 금액"), t("관리")], data.products.map(row => [e(row.name), U.badge(row.kind), `${t("{count}일", { count: row.days })}`, row.kind === "PERIOD" ? "—" : `${t("{count}회", { count: row.count })}`, U.money(row.price), canManageMoney ? U.button("product-edit", t("수정"), row.id) : t("조회 전용")]))}</section>`;
  }
  function attendance({ data, view }) {
    const selected = view.date || data.referenceDate;
    const month = view.month || selected.slice(0, 7);
    const [year, monthNumber] = month.split("-").map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const padding = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const cells = Array.from({ length: padding }, () => "<span></span>");
    for (let day = 1; day <= days; day++) {
      const value = `${month}-${String(day).padStart(2, "0")}`;
      const count = data.attendance.filter(row => row.visited_on === value && row.status === "PRESENT").length;
      cells.push(`<button data-action="visit-date" data-id="${value}" data-weekday="${(padding + day - 1) % 7}" ${value === data.referenceDate ? 'aria-current="date"' : ""} aria-pressed="${value === selected}"><strong>${day}</strong><small>${t("{count}명", { count })}</small></button>`);
    }
    const roster = U.roster(data, selected);
    const rows = roster.members.map(row => ({ ...row, member_id: row.id, visit: data.attendance.find(visit => visit.member_id === row.id && visit.visited_on === selected && visit.status === "PRESENT") }));
    const result = filtered(data, rows, view);
    return `<div class="op-columns"><section><div class="op-toolbar">${U.button("month", t("이전 달"), "-1")}<h2>${e(month)}</h2>${U.button("month", t("다음 달"), "1")}${U.button("visit-date", t("오늘"), data.referenceDate)}</div><div class="op-calendar">${["일", "월", "화", "수", "목", "금", "토"].map((day, index) => `<span data-weekday="${index}">${BoxingI18n.weekday(index)}</span>`).join("")}${cells.join("")}</div></section><section><div class="op-page-head"><h2>${e(t("{date} 출결", { date: selected }))}</h2></div><p>${t("전체 {total}명 · 출석 {present}명 · {remainder}", { total: roster.total, present: roster.present, remainder: selected > data.referenceDate ? t("미도래") : t("결석 {count}명", { count: roster.absent }) })}</p>${roster.unknown_registration_count ? `<p>${t("등록일 미확인 {count}명 제외", { count: roster.unknown_registration_count })}</p>` : ""}${filters(view)}${U.table([t("회원"), t("상태"), t("사유"), t("관리")], result.rows.map(row => [memberCell(data, row.member_id), row.attendance_status === "ABSENT" ? t("결석") : row.attendance_status === "UPCOMING" ? t("미도래") : U.badge("PRESENT"), e(row.visit?.reason || "—"), row.visit ? U.button("visit-cancel", t("취소"), row.visit.id, "op-danger") : row.attendance_status === "ABSENT" ? U.button("visit-new", t("출석 처리"), row.member_id) : "—"]), view.search ? t("검색 결과가 없습니다.") : t("선택 날짜에 등록된 회원이 없습니다."))}${U.pagination(result)}</section></div>`;
  }
  function payments({ data, view, canManageMoney }) {
    const query = (view.search || "").trim().toLocaleLowerCase();
    const rows = data.payments.filter(row => {
      const member = data.members.find(item => item.id === row.member_id);
      return `${member?.name || ""} ${member?.phone || ""}`.toLocaleLowerCase().includes(query) && (!view.status || row.status === view.status) && (!view.from || (row.paid_on && row.paid_on >= view.from)) && (!view.to || (row.paid_on && row.paid_on <= view.to));
    });
    const result = filtered(data, rows, view);
    const expected = rows.filter(row => row.status === "UNPAID").reduce((sum, row) => sum + row.amount, 0);
    const collected = rows.filter(row => ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes(row.status)).reduce((sum, row) => sum + row.amount - row.adjustments.reduce((total, item) => total + item.amount, 0), 0);
    return `<div class="op-page-head">${canManageMoney ? U.button("payment-new", t("수납 등록"), "", "op-primary") : ""}</div>${filters(view, `${U.field("from", t("수납 시작일"), view.from, { type: "date", required: false })}${U.field("to", t("수납 종료일"), view.to, { type: "date", required: false })}${U.field("status", t("결제 상태"), view.status, { required: false, options: [["", t("전체")], ...options(["PAID", "UNPAID", "CANCELLED", "PARTIAL_REFUND", "REFUNDED"])] })}`)}
      <div class="op-toolbar"><span>${t("선택 범위 수납 잔액")} <strong>${U.money(collected)}</strong></span><span>${t("미납 예정액")} <strong>${U.money(expected)}</strong></span></div>
      ${U.table([t("회원"), t("상품"), t("금액"), t("결제 수단"), t("수납일"), t("상태"), t("상세")], result.rows.map(row => [memberCell(data, row.member_id), e(name(data, "products", row.product_id)), U.money(row.amount), e(U.label(row.method)), e(row.paid_on || t("미수납")), U.badge(row.status), U.button("payment-detail", t("내역 보기"), row.id)]), view.search ? t("검색 결과가 없습니다.") : t("조건에 맞는 수납 내역이 없습니다."))}${U.pagination(result)}`;
  }
  function actions(context) {
    const { data, service, openForm, refresh, view } = context;
    const F = U.field;
    const reason = () => F("reason", t("변경 사유"), "", { multiline: true, max: 500 });
    const productForm = row => openForm(row ? t("상품 수정") : t("상품 등록"), F("name", t("상품명"), row?.name) + F("kind", t("유형"), row?.kind || "PERIOD", { options: options(["PERIOD", "COUNT", "TRIAL"]) }) + F("days", t("유효 일수"), row?.days ?? 30, { type: "number", min: 1 }) + F("count", t("횟수 (기간권은 0)"), row?.count ?? 0, { type: "number" }) + F("price", t("판매 금액 (원)"), row?.price ?? 0, { type: "number" }), (values, key) => service.saveProduct({ ...values, id: row?.id, days: Number(values.days), count: Number(values.count), price: Number(values.price) }, key));
    return {
      "product-new": () => productForm(),
      "product-edit": id => productForm(data.products.find(row => row.id === id)),
      "pass-new": memberId => openForm(t("회원에게 이용권 부여"), F("member_id", t("회원"), memberId, { options: memberOptions(data) }) + F("product_id", t("상품"), "", { options: productOptions(data) }) + F("start_on", t("시작일"), data.referenceDate, { type: "date" }) + F("end_on", t("만료일"), data.referenceDate, { type: "date", hint: t("자동 기간 계산 정책은 미확정입니다. 합의한 만료일을 직접 입력하세요.") }) + reason(), (values, key) => service.assignPass(values, key), t("확인 후 부여")),
      "pass-detail": id => {
        const row = data.passes.find(item => item.id === id);
        const changes = row.status === "PAUSED" ? ["RESUME", "EXTEND", "CANCEL"] : ["PAUSE", "EXTEND", "CANCEL"];
        const actionNames = { PAUSE: t("휴회"), RESUME: t("재개"), EXTEND: t("연장"), CANCEL: t("해지"), ASSIGN: t("부여"), SET_END: t("만료일 수정") };
        const history = U.table([t("변경"), t("사유"), t("담당자"), t("시각")], row.history.map(item => [e(actionNames[item.action]), e(item.reason), e(item.author), e(item.at)]));
        const content = `<p>${e(name(data, "members", row.member_id))} · ${e(name(data, "products", row.product_id))}</p><p>${e(row.start_on)} ~ ${e(row.end_on)} ${U.badge(U.passStatus(row, data.referenceDate))}</p>${history}`;
        if (row.status === "CANCELLED") return context.showDetail(t("회원권 이력"), content);
        openForm(t("회원권 변경 확인"), content + F("action", t("변경 종류"), changes[0], { options: changes.map(action => [action, actionNames[action]]) }) + F("end_on", t("새 만료일 (연장 선택 시)"), row.end_on, { type: "date", required: false }) + reason(), (values, key) => service.changePass({ ...values, id }, key), t("변경 확정"));
      },
      "visit-new": memberId => openForm(t("수동 출석 확인"), F("member_id", t("회원"), memberId || "", { options: U.roster(data, view.date || data.referenceDate).members.map(row => [row.id, row.name]) }) + F("visited_on", t("방문 날짜"), view.date || data.referenceDate, { type: "date" }) + reason(), (values, key) => service.markAttendance(values, key), t("출석 처리")),
      "visit-cancel": id => openForm(t("출석 취소 확인"), `<p>${t("선택한 출석을 취소 이력으로 남깁니다.")}</p>${reason()}`, (values, key) => service.cancelAttendance({ ...values, id }, key), t("취소 확정")),
      "visit-date": id => { view.date = id; view.month = id.slice(0, 7); view.followToday = id === data.referenceDate; view.page = 1; refresh(); },
      month: delta => {
        const [year, month] = (view.month || data.referenceDate.slice(0, 7)).split("-").map(Number);
        const value = new Date(Date.UTC(year, month - 1 + Number(delta), 1)).toISOString().slice(0, 10);
        view.month = value.slice(0, 7); view.date = value; view.followToday = false; view.page = 1; refresh();
      },
      "payment-new": memberId => openForm(t("수납 내역 등록"), F("member_id", t("회원"), memberId, { options: memberOptions(data) }) + F("product_id", t("상품"), "", { options: productOptions(data) }) + F("amount", t("금액 (원)"), "", { type: "number", min: 1 }) + F("method", t("결제 수단"), "CARD", { options: options(["CARD", "CASH", "TRANSFER", "KAKAOPAY", "EASY_PAY"]) }) + F("status", t("상태"), "PAID", { options: options(["PAID", "UNPAID"]) }) + F("paid_on", t("수납일 (미납 시 사용하지 않음)"), data.referenceDate, { type: "date", required: false }), (values, key) => service.registerPayment({ ...values, amount: Number(values.amount) }, key)),
      "payment-detail": id => {
        const row = data.payments.find(item => item.id === id);
        const content = `<p>${e(name(data, "members", row.member_id))} · ${e(name(data, "products", row.product_id))} · ${U.money(row.amount)} ${U.badge(row.status)}</p>${U.table([t("종류"), t("금액"), t("일자"), t("사유"), t("작성자")], row.adjustments.map(item => [e(item.action === "REFUND" ? t("환불 기록") : t("취소 기록")), U.money(item.amount), e(item.on), e(item.reason), e(item.author)]), t("취소·환불 이력이 없습니다."))}`;
        if (!context.canManageMoney || ["CANCELLED", "REFUNDED"].includes(row.status)) return context.showDetail(t("수납 상세"), content);
        const allowed = row.status === "UNPAID" ? [["CANCEL", t("취소 기록")]] : row.status === "PARTIAL_REFUND" ? [["REFUND", t("환불 기록")]] : [["CANCEL", t("취소 기록")], ["REFUND", t("환불 기록")]];
        openForm(t("취소·환불 내역 입력"), content + `<p>${t("실제 결제 취소·환불을 실행하지 않습니다.")}</p>` + F("action", t("기록 종류"), allowed[0][0], { options: allowed }) + F("amount", t("환불 기록 금액 (취소 시 0)"), 0, { type: "number" }) + F("on", t("처리 일자"), data.referenceDate, { type: "date" }) + reason(), (values, key) => service.adjustPayment({ ...values, amount: Number(values.amount), id }, key), t("기록 확정"));
      },
    };
  }
  root.OperationsCommerce = Object.freeze({ products, attendance, payments, actions, memberCell, memberOptions, filters });
})(window);
