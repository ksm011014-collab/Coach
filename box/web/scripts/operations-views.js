(function (root) {
  "use strict";
  function create({ data, view, actor, preview, openForm, own, service }) {
    const U = root.OperationsUI;
    const e = U.escape;
    const canEditMembers = ["OWNER", "CENTER_OWNER", "COACH"].includes(actor.role);
  function dashboard() {
    if (!preview && !data.operationsConnected) return `<section class="op-section"><h2>${t("운영 현황")}</h2><p>${t("이 역할에서는 회원 운동 데이터 조회만 가능합니다.")}</p>${U.button("navigate", t("회원 관리"), "members")}</section>`;
    const roster = U.roster(data, data.referenceDate);
    const percentage = roster.total ? Math.round(roster.present / roster.total * 1000) / 10 : 0;
    const months = U.revenueMonths(data);
    const maximum = Math.max(1, ...months.map(row => Math.abs(row.net)));
    return `<div class="op-columns"><section class="op-section"><h2>${t("오늘 출석 현황")}</h2><div class="op-attendance-chart"><div class="op-donut" style="--attendance:${percentage}%" role="img" aria-label="${t("전체 {total}명 중 오늘 출석 {present}명, 출석률 {percentage}%", { total: roster.total, present: roster.present, percentage })}"><strong>${percentage}%</strong></div><dl><dt>${t("전체 회원")}</dt><dd>${t("{count}명", { count: roster.total })}</dd><dt>${t("오늘 출석 회원")}</dt><dd>${t("{count}명", { count: roster.present })}</dd></dl></div>${roster.unknown_registration_count ? `<p role="status">${t("등록일 미확인 {count}명은 집계에서 제외됩니다. 회원 정보에서 등록일을 확인하세요.", { count: roster.unknown_registration_count })}</p>` : ""}${U.button("dashboard-visits", t("오늘 출결 보기"))}</section><section class="op-section"><h2>${t("최근 6개월 수익")}</h2><div class="op-revenue-chart" role="img" aria-label="${t("월별 수납 차감액 차트. 아래 표에 월별 금액을 표시합니다.")}">${months.map(row => `<div class="op-chart-column"><div class="op-chart-track"><span class="op-chart-bar ${row.net < 0 ? "is-negative" : ""}" style="height:${Math.abs(row.net) / maximum * 100}%"></span></div><small>${e(row.month)}</small></div>`).join("")}</div>${U.table([t("월"), t("수납"), t("환불·취소"), t("수익")], months.map(row => [e(row.month), U.money(row.collected), U.money(row.refunded), U.money(row.net)]))}</section></div>${OperationsCommerce.products({ data, canManageMoney: ["OWNER", "CENTER_OWNER"].includes(actor.role) })}`;
  }
  function members() {
    const selected = data.members.find(row => row.id === view().memberId);
    if (selected) return memberDetail(selected);
    const status = member => {
      const passes = data.passes.filter(row => row.member_id === member.id);
      return !preview && !data.operationsConnected ? "UNAVAILABLE" : passes.some(row => U.passStatus(row, data.referenceDate) === "ACTIVE") ? "ACTIVE" : passes.some(row => U.passStatus(row, data.referenceDate) === "PAUSED") ? "PAUSED" : passes.some(row => U.passStatus(row, data.referenceDate) === "UPCOMING") ? "UPCOMING" : passes.length ? "EXPIRED" : "NONE";
    };
    const rows = data.members.filter(row => !row.deleted_on && (!view().status || status(row) === view().status));
    const result = U.filterRows(rows, { search: view().search, page: view().page, text: row => `${row.name} ${row.phone}`, compare: (a, b) => view().sort === "joined" ? String(b.joined_on || "").localeCompare(String(a.joined_on || "")) : a.name.localeCompare(b.name, "ko") });
    return `${OperationsCommerce.filters(view(), U.field("status", t("회원권 상태"), view().status, { required: false, options: [["", t("전체")], ["ACTIVE", t("유효")], ["EXPIRED", t("만료·종료")]] }) + U.field("sort", t("정렬"), view().sort, { options: [["name", t("이름순")], ["joined", t("최근 등록순")]] }), t("회원 이름·연락처 검색"), ["OWNER", "CENTER_OWNER"].includes(actor.role) ? U.button("member-new", t("회원 등록"), "", "op-primary") : "")}${U.table([t("회원"), t("연락처"), t("회원권"), t("로그인 계정"), t("등록일"), t("관리")], result.rows.map(row => [OperationsCommerce.memberCell(data, row.id), e(row.phone), ["NONE", "PAUSED", "UPCOMING"].includes(status(row)) ? "—" : U.badge(status(row)), U.badge(row.account_status), e(row.joined_on), `<span class="op-row-actions">${canEditMembers ? U.button("member-edit", t("수정"), row.id) : ""}${["OWNER", "CENTER_OWNER"].includes(actor.role) ? U.button("member-delete", t("삭제"), row.id, "op-danger") : ""}</span>`]), view().search ? t("검색 결과가 없습니다.") : t("등록된 회원이 없습니다."))}${U.pagination(result)}`;
  }
  function memberDetail(member) {
    const tab = view().tab || "basic";
    const tabs = [["basic", t("기본 정보")], ["passes", t("회원권")], ["records", t("출석·운동")], ["payments", t("수납")], ["notes", t("상담·코치 메모")]];
    let content = "";
    if (tab === "basic") content = `<section class="op-card"><h2>${e(member.name)}</h2><p>${e(member.phone)}</p><p>${t("등록일")} ${e(member.joined_on)} · ${t("로그인 계정")} ${U.badge(member.account_status)}</p>${canEditMembers ? U.button("member-edit", t("기본 정보 수정"), member.id) : t("조회 전용")}</section>`;
    if (tab === "passes") {
      const result = U.filterRows(data.passes.filter(row => row.member_id === member.id), { search: view().search, page: view().page, text: row => data.products.find(product => product.id === row.product_id)?.name || "" });
      content = `${canEditMembers && !member.deleted_on ? U.button("pass-new", t("이용권 부여"), member.id) : ""}${OperationsCommerce.filters(view(), "", t("이용권 상품 검색"))}${U.table([t("상품"), t("기간"), t("잔여"), t("상태"), t("이력")], result.rows.map(row => [e(data.products.find(product => product.id === row.product_id)?.name), `${e(row.start_on)} ~ ${e(row.end_on)}`, row.remaining === null ? t("기간권") : `${t("{count}회", { count: row.remaining })}`, U.badge(U.passStatus(row, data.referenceDate)), U.button("pass-detail", t("변경·이력"), row.id)]), view().search ? t("검색 결과가 없습니다.") : t("부여된 회원권이 없습니다."))}${U.pagination(result)}`;
    }
    if (tab === "records") content = `<h2>${t("방문 출석")}</h2>${U.table([t("날짜"), t("상태"), t("사유")], data.attendance.filter(row => row.member_id === member.id).map(row => [e(row.visited_on), U.badge(row.status), e(row.reason)]))}<h2>${t("앱 운동 세션")}</h2>${workoutTable(data.workouts.filter(row => row.member_id === member.id))}`;
    if (tab === "payments") content = `${["OWNER", "CENTER_OWNER"].includes(actor.role) ? U.button("payment-new", t("수납 등록"), member.id) : ""}${U.table([t("수납일"), t("금액"), t("상태"), t("내역")], data.payments.filter(row => row.member_id === member.id).map(row => [e(row.paid_on || t("미수납")), U.money(row.amount), U.badge(row.status), U.button("payment-detail", t("내역 보기"), row.id)]))}`;
    if (tab === "notes") content = `${canEditMembers ? U.button("note-new", t("메모 작성"), member.id) : ""}${U.table([t("작성자"), t("작성 시각"), t("내용")], data.notes.filter(row => row.member_id === member.id).map(row => [e(row.author_name), e(row.created_at), `<span style="white-space:pre-wrap">${e(row.content)}</span>`]))}`;
    if (tab === "basic" && ["OWNER", "CENTER_OWNER"].includes(actor.role) && !member.deleted_on) content += U.button("member-delete", t("회원 삭제"), member.id, "op-danger");
    if (member.deleted_on) content = `<p role="status">${e(t("{date} 삭제된 회원입니다. 기존 이력은 보존됩니다.", { date: member.deleted_on }))}</p>${content}`;
    return `<div class="op-page-head">${U.button("member-back", t("회원 목록"))}<h2>${e(member.name)}</h2></div><div class="op-tabs" role="tablist" aria-label="${t("회원 상세")}">${tabs.map(([key, title]) => `<button role="tab" id="member-tab-${key}" aria-controls="member-panel" tabindex="${tab === key ? 0 : -1}" aria-selected="${tab === key}" data-action="member-tab" data-id="${key}">${title}</button>`).join("")}</div><section role="tabpanel" id="member-panel" tabindex="0" aria-labelledby="member-tab-${tab}">${content}</section>`;
  }
  function workoutTable(rows, empty = t("저장된 운동 기록이 없습니다. 방문 출석은 별도 화면에서 확인하세요.")) {
    return U.table([t("회원"), t("시작"), t("종료"), t("상태"), t("상세")], rows.map(row => [e(data.members.find(member => member.id === row.member_id)?.name), e(row.started_at), e(row.ended_at || "—"), row.ended_at ? t("완료") : t("진행 중"), `${U.button("workout-detail", t("기록 상세"), row.id)} ${!preview && row.has_recording ? U.button("recording-play", t("녹화 보기"), row.id) + U.button("recording-download", t("녹화 다운로드"), row.id) : ""} ${actor.role !== "PLATFORM_ADMIN" ? U.button("workout-delete", t("삭제"), row.id, "op-danger") : ""}`]), empty);
  }
  function workouts() {
    const rows = own(data.workouts).filter(row => (!view().status || (row.ended_at ? "COMPLETE" : "OPEN") === view().status) && (!view().from || row.started_at.slice(0, 10) >= view().from) && (!view().to || row.started_at.slice(0, 10) <= view().to));
    const result = U.filterRows(rows, { search: view().search, page: view().page, text: row => { const member = data.members.find(item => item.id === row.member_id); return `${member?.name || ""} ${member?.phone || ""}`; }, compare: (a, b) => view().sort === "oldest" ? a.started_at.localeCompare(b.started_at) : b.started_at.localeCompare(a.started_at) });
    return `${OperationsCommerce.filters(view(), U.field("from", t("시작일"), view().from, { type: "date", required: false }) + U.field("to", t("종료일"), view().to, { type: "date", required: false }) + U.field("status", t("완료 상태"), view().status, { required: false, options: [["", t("전체")], ["COMPLETE", t("완료")], ["OPEN", t("진행 중")]] }) + U.field("sort", t("정렬"), view().sort, { options: [["newest", t("최신순")], ["oldest", t("오래된순")]] }))}${workoutTable(result.rows, view().search ? t("검색 결과가 없습니다.") : undefined)}${U.pagination(result)}`;
  }
  function home() {
    if (!preview && !data.operationsConnected) return `<section class="op-section"><h2>${t("내 이용 현황")}</h2><p>${t("이용권·방문 출석·수납 내역은 백엔드 연결 준비 중입니다.")}</p><p>${t("운동 세션 {count}건 · 방문 출석과 별도 집계", { count: data.workouts.length })}</p>${U.button("navigate", t("내 운동 기록 보기"), "workouts")}</section>`;
    const passes = own(data.passes);
    const visits = own(data.attendance).filter(row => row.status === "PRESENT");
    return `<section class="op-section"><h2>${t("내 이용권")}</h2>${U.table([t("상품"), t("기간"), t("잔여 횟수"), t("상태")], passes.map(row => [e(data.products.find(product => product.id === row.product_id)?.name), `${e(row.start_on)} ~ ${e(row.end_on)}`, row.remaining === null ? t("기간권") : `${t("{count}회", { count: row.remaining })}`, U.badge(U.passStatus(row, data.referenceDate))]))}</section><div class="op-columns"><section><h2>${t("최근 방문 출석")}</h2>${U.table([t("방문일"), t("상태")], visits.slice().sort((a, b) => b.visited_on.localeCompare(a.visited_on)).slice(0, 5).map(row => [e(row.visited_on), t("출석")]))}</section><section><h2>${t("앱 운동 기록")}</h2><p>${t("{count}건 저장 · 방문 출석과 별도 집계", { count: data.workouts.length })}</p>${U.button("navigate", t("운동 기록 보기"), "workouts")}</section></div><section class="op-section"><h2>${t("내 수납 내역")}</h2>${U.table([t("수납일"), t("금액"), t("상태"), t("상세")], own(data.payments).map(row => [e(row.paid_on || t("미수납")), U.money(row.amount), U.badge(row.status), U.button("payment-detail", t("내역 보기"), row.id)]))}</section>`;
  }
  function memberForm(id) {
    const row = data.members.find(member => member.id === id);
    if (!row && !["OWNER", "CENTER_OWNER"].includes(actor.role)) throw new Error(t("회원 등록은 관리자만 할 수 있습니다."));
    if (row?.deleted_on) throw new Error(t("삭제된 회원은 수정할 수 없습니다."));
    const identity = !preview && !row ? U.field("username", t("로그인 아이디")) + U.field("email", t("이메일"), "", { type: "email" }) + U.field("password", t("비밀번호 (특수문자 포함 8자 이상)"), "", { type: "password", max: 256 }) + U.field("password_confirm", t("비밀번호 확인"), "", { type: "password", max: 256 }) : "";
    const profile = U.field("birthdate", t("생년월일"), row?.birthdate, { type: "date", required: false }) + U.field("gender", t("성별"), row?.gender, { required: false, options: [["", t("선택 안 함")], ["male", t("남성")], ["female", t("여성")], ["other", t("기타")]] }) + U.field("height_cm", t("키 (cm)"), row?.height_cm || "", { type: "number", required: false }) + U.field("weight_kg", t("체중 (kg)"), row?.weight_kg || "", { type: "number", required: false }) + U.field("training_level", t("훈련 단계"), row?.training_level || 1, { type: "number", min: 1 }) + U.field("stance", t("스탠스"), row?.stance || "orthodox", { options: [["orthodox", t("오소독스")], ["southpaw", t("사우스포")]] }) + U.field("injury_note", t("메모"), row?.injury_note, { multiline: true, max: 2000, required: false });
    const passes = data.passes.filter(pass => pass.member_id === row?.id && pass.status !== "CANCELLED");
    const registration = row
      ? passes.length ? U.field("pass_id", t("만료일을 변경할 이용권"), "", { required: false, options: [["", t("변경 안 함")], ...passes.map(pass => [pass.id, `${data.products.find(product => product.id === pass.product_id)?.name || t("이용권")} · ${pass.start_on} ~ ${pass.end_on}`])] }) + U.field("end_on", t("새 만료일"), "", { type: "date", required: false }) + U.field("reason", t("만료일 변경 사유"), "", { required: false, max: 500 }) : ""
      : U.field("joined_on", t("등록일"), data.referenceDate, { type: "date" }) + U.field("product_id", t("함께 부여할 이용권"), "", { required: false, options: [["", t("이용권 없이 등록")], ...data.products.map(product => [product.id, product.name])] }) + U.field("start_on", t("이용권 시작일"), data.referenceDate, { type: "date", required: false }) + U.field("end_on", t("이용권 만료일"), "", { type: "date", required: false });
    openForm(row ? t("회원 정보 수정") : t("회원 등록"), identity + U.field("name", t("이름"), row?.name, { max: 100 }) + U.field("phone", t("연락처"), row?.phone, { type: "tel", max: 30, required: preview }) + profile + registration + (preview ? `<p>${t("샘플 회원 프로필만 저장합니다. 로그인 계정은 생성하지 않습니다.")}</p>` : ""), (values, key) => service.saveMember({ ...values, id: row?.id, version: row?.version, ...(values.pass_id ? { pass_version: passes.find(pass => pass.id === values.pass_id)?.version } : {}) }, key));
  }

    return { dashboard, members, workouts, home, memberForm };
  }
  root.OperationsViews = Object.freeze({ create });
})(window);
