(function (root) {
  "use strict";
  const U = root.OperationsUI;
  const e = U.escape;
  const options = values => values.map(value => [value, U.label(value)]);
  const memberOptions = data => data.members.map(row => [row.id, row.name]);
  const productOptions = data => data.products.map(row => [row.id, row.name]);
  function name(data, collection, id) { return data[collection].find(row => row.id === id)?.name || "확인 불가"; }
  function memberCell(data, id) { return U.button("member", name(data, "members", id), id, "op-link"); }
  function filters(view, extra = "") {
    return `<form class="op-toolbar" data-filter>${U.field("search", "회원 이름·연락처 검색", view.search, { required: false })}${extra}<button type="submit">조회</button>${U.button("clear-filter", "초기화")}</form>`;
  }
  function filtered(data, rows, view, toText) {
    return U.filterRows(rows, { search: view.search, page: view.page, text: toText || (row => name(data, "members", row.member_id)), compare: (a, b) => String(b.created_at || b.id).localeCompare(String(a.created_at || a.id)) });
  }
  function memberships({ data, view, canManageMoney }) {
    const products = data.products.map(row => [e(row.name), U.badge(row.kind), `${row.days}일`, row.kind === "PERIOD" ? "—" : `${row.count}회`, U.money(row.price), canManageMoney ? U.button("product-edit", "수정", row.id) : "조회 전용"]);
    const rows = data.passes.filter(row => (!view.status || U.passStatus(row, data.referenceDate) === view.status) && (!view.expiresBy || (row.end_on >= data.referenceDate && row.end_on <= view.expiresBy)));
    const result = filtered(data, rows, view);
    return `<section class="op-section"><div class="op-page-head"><h2>회원권 상품</h2>${canManageMoney ? U.button("product-new", "상품 등록", "", "op-primary") : ""}</div>${U.table(["상품명", "유형", "유효 기간", "횟수", "판매 금액", "관리"], products)}</section>
      <section class="op-section"><div class="op-page-head"><h2>회원 이용권</h2>${U.button("pass-new", "이용권 부여", "", "op-primary")}</div>
      ${filters(view, U.field("status", "상태", view.status, { required: false, options: [["", "전체"], ...options(["ACTIVE", "PAUSED", "UPCOMING", "EXPIRED", "CANCELLED"])] }) + U.field("expiresBy", "만료 예정일까지", view.expiresBy, { type: "date", required: false }))}
      ${U.table(["회원", "상품", "기간", "잔여", "상태", "변경·이력"], result.rows.map(row => [memberCell(data, row.member_id), e(name(data, "products", row.product_id)), `${e(row.start_on)} ~ ${e(row.end_on)}`, row.remaining === null ? "기간권" : `${row.remaining}회`, U.badge(U.passStatus(row, data.referenceDate)), U.button("pass-detail", "변경·이력", row.id)]), view.search ? "검색 결과가 없습니다." : "부여된 회원권이 없습니다.")}${U.pagination(result)}
      <p class="op-muted">기준일 ${e(data.referenceDate)} · 휴회 시 만료일 자동 변경과 방문 시 횟수 차감은 적용하지 않습니다.</p></section>`;
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
      cells.push(`<button data-action="visit-date" data-id="${value}" aria-pressed="${value === selected}"><strong>${day}</strong><small>${count}명</small></button>`);
    }
    const result = filtered(data, data.attendance.filter(row => row.visited_on === selected), view);
    return `<p class="op-muted">방문 출석입니다. 앱 운동 세션과 별도로 관리합니다.</p><div class="op-columns"><section><div class="op-toolbar">${U.button("month", "이전 달", "-1")}<h2>${e(month)}</h2>${U.button("month", "다음 달", "1")}${U.button("visit-date", "오늘", data.referenceDate)}</div><div class="op-calendar">${["일", "월", "화", "수", "목", "금", "토"].map(day => `<span>${day}</span>`).join("")}${cells.join("")}</div></section><section><div class="op-page-head"><h2>${e(selected)} 출석</h2>${U.button("visit-new", "수동 출석", "", "op-primary")}</div>${filters(view)}${U.table(["회원", "상태", "사유", "관리"], result.rows.map(row => [memberCell(data, row.member_id), U.badge(row.status), e(row.reason), row.status === "PRESENT" ? U.button("visit-cancel", "취소", row.id, "op-danger") : "취소됨"]), view.search ? "검색 결과가 없습니다." : "선택 날짜에 출석 내역이 없습니다.")}${U.pagination(result)}</section></div>`;
  }
  function payments({ data, view, canManageMoney }) {
    const rows = data.payments.filter(row => (!view.status || row.status === view.status) && (!view.from || (row.paid_on && row.paid_on >= view.from)) && (!view.to || (row.paid_on && row.paid_on <= view.to)));
    const result = filtered(data, rows, view);
    const expected = rows.filter(row => row.status === "UNPAID").reduce((sum, row) => sum + row.amount, 0);
    const collected = rows.filter(row => ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes(row.status)).reduce((sum, row) => sum + row.amount - row.adjustments.reduce((total, item) => total + item.amount, 0), 0);
    return `<div class="op-page-head"><p class="op-muted">수납·취소·환불 사실을 기록합니다. 결제나 실제 환불을 실행하지 않습니다.</p>${canManageMoney ? U.button("payment-new", "수납 등록", "", "op-primary") : ""}</div>${filters(view, `${U.field("from", "수납 시작일", view.from, { type: "date", required: false })}${U.field("to", "수납 종료일", view.to, { type: "date", required: false })}${U.field("status", "결제 상태", view.status, { required: false, options: [["", "전체"], ...options(["PAID", "UNPAID", "CANCELLED", "PARTIAL_REFUND", "REFUNDED"])] })}`)}
      <div class="op-toolbar"><span>선택 범위 수납 잔액 <strong>${U.money(collected)}</strong></span><span>미납 예정액 <strong>${U.money(expected)}</strong></span></div><p class="op-muted">환불 기록을 차감한 목록 기준 합계입니다. 미납은 수납일이 없어 날짜 필터 적용 시 제외됩니다.</p>
      ${U.table(["회원", "상품", "금액", "결제 수단", "수납일", "상태", "상세"], result.rows.map(row => [memberCell(data, row.member_id), e(name(data, "products", row.product_id)), U.money(row.amount), e(U.label(row.method)), e(row.paid_on || "미수납"), U.badge(row.status), U.button("payment-detail", "내역 보기", row.id)]), view.search ? "검색 결과가 없습니다." : "조건에 맞는 수납 내역이 없습니다.")}${U.pagination(result)}`;
  }
  function actions(context) {
    const { data, service, openForm, refresh, view } = context;
    const F = U.field;
    const reason = () => F("reason", "변경 사유", "", { multiline: true, max: 500 });
    const productForm = row => openForm(row ? "상품 수정" : "상품 등록", F("name", "상품명", row?.name) + F("kind", "유형", row?.kind || "PERIOD", { options: options(["PERIOD", "COUNT", "TRIAL"]) }) + F("days", "유효 일수", row?.days ?? 30, { type: "number", min: 1 }) + F("count", "횟수 (기간권은 0)", row?.count ?? 0, { type: "number" }) + F("price", "판매 금액 (원)", row?.price ?? 0, { type: "number" }), (values, key) => service.saveProduct({ ...values, id: row?.id, days: Number(values.days), count: Number(values.count), price: Number(values.price) }, key));
    return {
      "product-new": () => productForm(),
      "product-edit": id => productForm(data.products.find(row => row.id === id)),
      "pass-new": memberId => openForm("회원에게 이용권 부여", F("member_id", "회원", memberId, { options: memberOptions(data) }) + F("product_id", "상품", "", { options: productOptions(data) }) + F("start_on", "시작일", data.referenceDate, { type: "date" }) + F("end_on", "만료일", data.referenceDate, { type: "date", hint: "자동 기간 계산 정책은 미확정입니다. 합의한 만료일을 직접 입력하세요." }) + reason(), (values, key) => service.assignPass(values, key), "확인 후 부여"),
      "pass-detail": id => {
        const row = data.passes.find(item => item.id === id);
        const changes = row.status === "PAUSED" ? ["RESUME", "EXTEND", "CANCEL"] : ["PAUSE", "EXTEND", "CANCEL"];
        const actionNames = { PAUSE: "휴회", RESUME: "재개", EXTEND: "연장", CANCEL: "해지", ASSIGN: "부여" };
        const history = U.table(["변경", "사유", "담당자", "시각"], row.history.map(item => [e(actionNames[item.action]), e(item.reason), e(item.author), e(item.at)]));
        const content = `<p>${e(name(data, "members", row.member_id))} · ${e(name(data, "products", row.product_id))}</p><p>${e(row.start_on)} ~ ${e(row.end_on)} ${U.badge(U.passStatus(row, data.referenceDate))}</p>${history}`;
        if (row.status === "CANCELLED") return context.showDetail("회원권 이력", content);
        openForm("회원권 변경 확인", content + F("action", "변경 종류", changes[0], { options: changes.map(action => [action, actionNames[action]]) }) + F("end_on", "새 만료일 (연장 선택 시)", row.end_on, { type: "date", required: false }) + reason(), (values, key) => service.changePass({ ...values, id }, key), "변경 확정");
      },
      "visit-new": () => openForm("수동 출석 확인", F("member_id", "회원", "", { options: memberOptions(data) }) + F("visited_on", "방문 날짜", view.date || data.referenceDate, { type: "date" }) + reason(), (values, key) => service.markAttendance(values, key), "출석 처리"),
      "visit-cancel": id => openForm("출석 취소 확인", `<p>선택한 출석을 취소 이력으로 남깁니다.</p>${reason()}`, (values, key) => service.cancelAttendance({ ...values, id }, key), "취소 확정"),
      "visit-date": id => { view.date = id; view.month = id.slice(0, 7); view.page = 1; refresh(); },
      month: delta => {
        const [year, month] = (view.month || data.referenceDate.slice(0, 7)).split("-").map(Number);
        const value = new Date(Date.UTC(year, month - 1 + Number(delta), 1)).toISOString().slice(0, 10);
        view.month = value.slice(0, 7); view.date = value; view.page = 1; refresh();
      },
      "payment-new": memberId => openForm("수납 내역 등록", F("member_id", "회원", memberId, { options: memberOptions(data) }) + F("product_id", "상품", "", { options: productOptions(data) }) + F("amount", "금액 (원)", "", { type: "number", min: 1 }) + F("method", "결제 수단", "CARD", { options: options(["CARD", "CASH", "TRANSFER"]) }) + F("status", "상태", "PAID", { options: options(["PAID", "UNPAID"]) }) + F("paid_on", "수납일 (미납 시 사용하지 않음)", data.referenceDate, { type: "date", required: false }), (values, key) => service.registerPayment({ ...values, amount: Number(values.amount) }, key)),
      "payment-detail": id => {
        const row = data.payments.find(item => item.id === id);
        const content = `<p>${e(name(data, "members", row.member_id))} · ${e(name(data, "products", row.product_id))} · ${U.money(row.amount)} ${U.badge(row.status)}</p>${U.table(["종류", "금액", "일자", "사유", "작성자"], row.adjustments.map(item => [e(item.action === "REFUND" ? "환불 기록" : "취소 기록"), U.money(item.amount), e(item.on), e(item.reason), e(item.author)]), "취소·환불 이력이 없습니다.")}`;
        if (!context.canManageMoney || ["CANCELLED", "REFUNDED"].includes(row.status)) return context.showDetail("수납 상세", content);
        const allowed = row.status === "UNPAID" ? [["CANCEL", "취소 기록"]] : row.status === "PARTIAL_REFUND" ? [["REFUND", "환불 기록"]] : [["CANCEL", "취소 기록"], ["REFUND", "환불 기록"]];
        openForm("취소·환불 내역 입력", content + "<p>실제 결제 취소·환불을 실행하지 않습니다.</p>" + F("action", "기록 종류", allowed[0][0], { options: allowed }) + F("amount", "환불 기록 금액 (취소 시 0)", 0, { type: "number" }) + F("on", "처리 일자", data.referenceDate, { type: "date" }) + reason(), (values, key) => service.adjustPayment({ ...values, amount: Number(values.amount), id }, key), "기록 확정");
      },
    };
  }
  root.OperationsCommerce = Object.freeze({ memberships, attendance, payments, actions, memberCell, memberOptions, filters });
})(window);
