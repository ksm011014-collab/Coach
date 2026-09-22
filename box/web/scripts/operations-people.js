(function (root) {
  "use strict";
  const U = root.OperationsUI;
  const e = U.escape;
  const F = U.field;
  function create({ data, view, actor, service, openForm }) {
    const owner = ["OWNER", "CENTER_OWNER"].includes(actor.role);
    function center() {
      const row = data.center;
      return `<section class="op-form"><h2>${e(row.name)}</h2><p>연락처 ${e(row.phone)}</p><p>주소 ${e(row.address)}</p><p>운영 시간 ${e(row.hours)}</p><p>등록 회원 ${data.members.length}명 · 직원 프로필 ${data.staff.length}명</p>${owner ? U.button("center-edit", "센터 정보 수정") : "<p>코치는 조회만 가능합니다.</p>"}</section>`;
    }
    function staff() {
      const selected = data.staff.filter(row => !view().status || row.status === view().status);
      const result = U.filterRows(selected, { search: view().search, page: view().page, text: row => `${row.name} ${row.phone} ${row.job}` });
      return `<div class="op-page-head">${owner ? U.button("staff-new", "직원 프로필 등록", "", "op-primary") : "<p>조회 전용</p>"}</div>${OperationsCommerce.filters(view(), F("status", "재직 상태", view().status, { required: false, options: [["", "전체"], ["ACTIVE", "재직"], ["INACTIVE", "퇴직"]] }), "이름·연락처·직무 검색")}${U.table(["직원", "연락처", "직무", "재직 상태", "로그인 권한", "관리"], result.rows.map(row => [e(row.name), e(row.phone), e(row.job), row.status === "ACTIVE" ? "재직" : "퇴직", "업무 프로필과 별도", owner ? U.button("staff-edit", "수정", row.id) : "조회 전용"]), view().search ? "검색 결과가 없습니다." : "직원 프로필이 없습니다.")}${U.pagination(result)}`;
    }
    function profile() {
      return `<section class="op-form"><h2>${e(data.profile.name)}</h2><p>${e(data.profile.phone)}</p><p>로그인 역할: ${e({ CENTER_OWNER: "관리자", COACH: "코치", MEMBER: "회원" }[actor.role])}</p>${U.button("profile-edit", "내 프로필 수정")}</section>`;
    }
    function staffForm(id) {
      const row = data.staff.find(item => item.id === id);
      openForm(row ? "직원 프로필 수정" : "직원 프로필 등록", F("name", "이름", row?.name, { max: 100 }) + F("phone", "연락처", row?.phone, { type: "tel", max: 30 }) + F("job", "직무", row?.job, { max: 100 }) + F("status", "재직 상태", row?.status || "ACTIVE", { options: [["ACTIVE", "재직"], ["INACTIVE", "퇴직"]] }) + "<p>로그인 계정을 생성하거나 권한을 변경하지 않습니다.</p>", (values, key) => service.saveStaff({ ...values, id: row?.id }, key));
    }
    const actions = {
      "staff-new": () => staffForm(), "staff-edit": staffForm,
      "center-edit": () => openForm("센터 정보 수정", F("name", "센터명", data.center.name) + F("phone", "연락처", data.center.phone, { type: "tel", max: 30 }) + F("address", "주소", data.center.address, { max: 300 }) + F("hours", "운영 시간", data.center.hours, { max: 200 }), (values, key) => service.saveCenter(values, key)),
      "profile-edit": () => openForm("내 프로필 수정", F("name", "이름", data.profile.name, { max: 100 }) + F("phone", "연락처", data.profile.phone, { type: "tel", max: 30 }), (values, key) => service.saveProfile(values, key)),
    };
    return { center, staff, profile, actions };
  }
  root.OperationsPeople = Object.freeze({ create });
})(window);
