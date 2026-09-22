const accountView = { search: "", role: "", status: "", page: 1 };
const pendingAccountWrites = new Set();

function renderAccounts() {
  if (!roleCanManageAccounts(state.user?.role)) {
    $("#viewContent").innerHTML = `<section class="admin-board"><p>${t("계정 관리 권한이 없습니다.")}</p></section>`;
    return;
  }

  const U = OperationsUI;
  const matching = state.accounts.filter(account => (!accountView.role || account.role === accountView.role) && (!accountView.status || account.status === accountView.status));
  const result = U.filterRows(matching, { search: accountView.search, page: accountView.page, text: account => `${account.name} ${account.username} ${account.center_name || ""}`, compare: (a, b) => (a.name || a.username).localeCompare(b.name || b.username, "ko") });
  const rows = result.rows.map((account) => {
    const isSelf = account.id === state.user.id;
    return `<tr>
      <td><strong>${escapeHtml(account.name || account.username)}</strong><small class="table-subline">${escapeHtml(account.username)}</small></td>
      <td>${escapeHtml(account.center_name || t("전체 센터"))}</td>
      <td>
        <select aria-label="${escapeHtml(t("{name} 역할", { name: account.name }))}" data-account-role="${escapeHtml(account.id)}" ${isSelf ? "disabled" : ""}>
          ${accountRoleOptions(account.role)}
        </select>
      </td>
      <td>
        <select aria-label="${escapeHtml(t("{name} 계정 상태", { name: account.name }))}" data-account-status="${escapeHtml(account.id)}" ${isSelf ? "disabled" : ""}>
          <option value="ACTIVE" ${account.status === "ACTIVE" ? "selected" : ""}>${t("사용 중")}</option>
          <option value="SUSPENDED" ${account.status === "SUSPENDED" ? "selected" : ""}>${t("정지")}</option>
        </select>
      </td>
      <td><button class="ghost small-button" data-save-account="${account.id}" ${isSelf ? "disabled" : ""}>${t("권한 저장")}</button></td>
    </tr>`;
  }).join("");

  $("#viewContent").innerHTML = `<section class="operations op-embedded accounts-layout">
    <section>
      <div class="section-heading">
        <div><span>ACCESS CONTROL</span><h3>${t("계정 및 권한")}</h3></div>
        <button id="toggleAccountCreate">${state.showAccountCreateForm ? t("닫기") : t("계정 추가")}</button>
      </div>
      <p id="accountsMessage" role="status">${escapeHtml(state.accountsMessage || t("권한 변경과 계정 정지는 다음 서버 요청부터 적용됩니다."))}</p>
      ${state.showAccountCreateForm ? accountCreateForm() : ""}
      <form id="accountFilters" class="op-toolbar">${U.field("search", t("검색"), accountView.search, { required: false })}${U.field("role", t("역할"), accountView.role, { required: false, options: [["", t("전체")], ...["PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"].map(role => [role, roleLabel(role)])] })}${U.field("status", t("계정 상태"), accountView.status, { required: false, options: [["", t("전체")], ["ACTIVE", t("사용 중")], ["SUSPENDED", t("정지")]] })}<button>${t("조회")}</button></form>
      <div class="op-table-scroll" tabindex="0" role="region" aria-label="${t("로그인 계정 목록")}"><table class="accounts-table">
        <thead><tr><th>${t("계정")}</th><th>${t("센터")}</th><th>${t("역할")}</th><th>${t("상태")}</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">${t("표시할 계정이 없습니다.")}</td></tr>`}</tbody>
      </table></div>${U.pagination(result)}
    </section>
  </section>`;

  $("#toggleAccountCreate").addEventListener("click", () => {
    state.showAccountCreateForm = !state.showAccountCreateForm;
    state.accountsMessage = "";
    renderAccounts();
  });
  $("#accountFilters").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.busy) return;
    Object.assign(accountView, Object.fromEntries(new FormData(form)), { page: 1 });
    form.dataset.busy = "true";
    try { await reloadManagedAccounts(); state.accountsMessage = t("목록을 불러왔습니다."); }
    catch (error) { state.accountsMessage = error.message; }
    renderAccounts();
    $("#accountFilters [name=search]").focus();
  });
  document.querySelectorAll('[data-action="page"]').forEach(button => button.addEventListener("click", () => { accountView.page = Number(button.dataset.id); renderAccounts(); }));
  document.querySelectorAll("[data-save-account]").forEach((button) => {
    button.addEventListener("click", () => saveAccountAccess(button.dataset.saveAccount));
  });
  const createForm = $("#accountCreateForm");
  if (createForm) createForm.addEventListener("submit", createManagedAccount);
}

function accountRoleOptions(selected) {
  const roles = state.user.role === "PLATFORM_ADMIN"
    ? ["PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"]
    : ["COACH", "MEMBER"];
  return roles.map((role) => `<option value="${role}" ${role === selected ? "selected" : ""}>${roleLabel(role)}</option>`).join("");
}

function accountCreateForm() {
  const U = OperationsUI;
  const centers = uniqueAccountCenters();
  const centerField = state.user.role === "PLATFORM_ADMIN"
    ? `<select name="center_id"><option value="">${t("센터 없음")}</option>${centers.map((center) => `<option value="${center.id}">${escapeHtml(center.name)}</option>`).join("")}</select>`
    : "";
  return `<form id="accountCreateForm" class="op-form op-section">
    ${U.field("username", t("아이디"))}${U.field("name", t("이름"))}${U.field("email", t("연락 이메일 (선택)"), "", { type: "email", required: false })}
    <label class="op-field">${t("역할")}<select name="role">${accountRoleOptions("MEMBER")}</select></label>
    ${centerField ? `<label class="op-field">${t("센터")}${centerField}</label>` : ""}
    ${U.field("password", t("임시 비밀번호"), "", { type: "password", max: 256 })}${U.field("password_confirm", t("비밀번호 확인"), "", { type: "password", max: 256 })}
    <button>${t("계정 생성")}</button>
  </form>`;
}

function uniqueAccountCenters() {
  const centers = new Map();
  state.platformCenters.forEach((center) => {
    if (center.id && center.name) centers.set(center.id, { id: center.id, name: center.name });
  });
  state.accounts.forEach((account) => {
    if (account.center_id && account.center_name) centers.set(account.center_id, { id: account.center_id, name: account.center_name });
  });
  return [...centers.values()].sort((first, second) => first.name.localeCompare(second.name, "ko"));
}

async function reloadManagedAccounts() {
  const result = await api("/admin/accounts");
  state.accounts = result.accounts;
}

async function saveAccountAccess(accountId) {
  if (pendingAccountWrites.has(accountId)) return;
  pendingAccountWrites.add(accountId);
  const button = document.querySelector(`[data-save-account="${accountId}"]`);
  button.disabled = true;
  const role = document.querySelector(`[data-account-role="${accountId}"]`).value;
  const status = document.querySelector(`[data-account-status="${accountId}"]`).value;
  try {
    await api(`/admin/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ role, status }),
    });
    state.accountsMessage = t("계정 권한을 저장했습니다.");
    try { await reloadManagedAccounts(); }
    catch (error) { state.accountsMessage = t("권한은 저장됐지만 목록 조회에 실패했습니다. 조회 버튼으로 다시 확인하세요. {error}", { error: error.message }); }
  } catch (error) {
    state.accountsMessage = error.message;
    $("#accountsMessage").textContent = error.message;
    return;
  } finally {
    pendingAccountWrites.delete(accountId);
    button.disabled = false;
  }
  renderAccounts();
}

async function createManagedAccount(event) {
  event.preventDefault();
  if (pendingAccountWrites.has("create")) return;
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (body.password !== body.password_confirm) {
    state.accountsMessage = t("비밀번호 확인이 일치하지 않습니다.");
    $("#accountsMessage").textContent = state.accountsMessage;
    return;
  }
  pendingAccountWrites.add("create");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/admin/accounts", { method: "POST", body: JSON.stringify(body) });
    state.showAccountCreateForm = false;
    state.accountsMessage = t("새 계정을 생성했습니다.");
    try { await reloadManagedAccounts(); }
    catch (error) { state.accountsMessage = t("계정은 생성됐지만 목록 조회에 실패했습니다. 다시 생성하지 말고 조회 버튼으로 확인하세요. {error}", { error: error.message }); }
  } catch (error) {
    state.accountsMessage = error.message;
    $("#accountsMessage").textContent = error.message;
    return;
  } finally {
    pendingAccountWrites.delete("create");
    button.disabled = false;
  }
  renderAccounts();
}
