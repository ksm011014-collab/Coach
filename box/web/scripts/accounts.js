const accountView = { search: "", role: "", status: "", page: 1 };
const pendingAccountWrites = new Set();

function renderAccounts() {
  if (!roleCanManageAccounts(state.user?.role)) {
    $("#viewContent").innerHTML = `<section class="admin-board"><p>계정 관리 권한이 없습니다.</p></section>`;
    return;
  }

  const U = OperationsUI;
  const matching = state.accounts.filter(account => (!accountView.role || account.role === accountView.role) && (!accountView.status || account.status === accountView.status));
  const result = U.filterRows(matching, { search: accountView.search, page: accountView.page, text: account => `${account.name} ${account.username} ${account.center_name || ""}`, compare: (a, b) => (a.name || a.username).localeCompare(b.name || b.username, "ko") });
  const rows = result.rows.map((account) => {
    const isSelf = account.id === state.user.id;
    return `<tr>
      <td><strong>${escapeHtml(account.name || account.username)}</strong><small class="table-subline">${escapeHtml(account.username)}</small></td>
      <td>${escapeHtml(account.center_name || "전체 센터")}</td>
      <td>
        <select aria-label="${escapeHtml(account.name)} 역할" data-account-role="${escapeHtml(account.id)}" ${isSelf ? "disabled" : ""}>
          ${accountRoleOptions(account.role)}
        </select>
      </td>
      <td>
        <select aria-label="${escapeHtml(account.name)} 계정 상태" data-account-status="${escapeHtml(account.id)}" ${isSelf ? "disabled" : ""}>
          <option value="ACTIVE" ${account.status === "ACTIVE" ? "selected" : ""}>사용 중</option>
          <option value="SUSPENDED" ${account.status === "SUSPENDED" ? "selected" : ""}>정지</option>
        </select>
      </td>
      <td><button class="ghost small-button" data-save-account="${account.id}" ${isSelf ? "disabled" : ""}>권한 저장</button></td>
    </tr>`;
  }).join("");

  $("#viewContent").innerHTML = `<section class="operations op-embedded accounts-layout">
    <section>
      <div class="section-heading">
        <div><span>ACCESS CONTROL</span><h3>계정 및 권한</h3></div>
        <button id="toggleAccountCreate">${state.showAccountCreateForm ? "닫기" : "계정 추가"}</button>
      </div>
      <p>로그인 접근 권한을 관리합니다. 직원 업무 프로필·회원권 상태와 별개입니다.</p>
      <p id="accountsMessage" role="status">${escapeHtml(state.accountsMessage || "권한 변경과 계정 정지는 다음 서버 요청부터 적용됩니다.")}</p>
      ${state.showAccountCreateForm ? accountCreateForm() : ""}
      <form id="accountFilters" class="op-toolbar">${U.field("search", "검색", accountView.search, { required: false })}${U.field("role", "역할", accountView.role, { required: false, options: [["", "전체"], ...["PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"].map(role => [role, roleLabel(role)])] })}${U.field("status", "계정 상태", accountView.status, { required: false, options: [["", "전체"], ["ACTIVE", "사용 중"], ["SUSPENDED", "정지"]] })}<button>조회</button></form>
      <div class="op-table-scroll" tabindex="0" role="region" aria-label="로그인 계정 목록"><table class="accounts-table">
        <thead><tr><th>계정</th><th>센터</th><th>역할</th><th>상태</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">표시할 계정이 없습니다.</td></tr>`}</tbody>
      </table></div>${U.pagination(result)}
    </section>
  </section>`;

  $("#toggleAccountCreate").addEventListener("click", () => {
    state.showAccountCreateForm = !state.showAccountCreateForm;
    state.accountsMessage = "";
    renderAccounts();
  });
  $("#accountFilters").addEventListener("submit", event => {
    event.preventDefault(); Object.assign(accountView, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 }); renderAccounts();
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
    ? `<select name="center_id"><option value="">센터 없음</option>${centers.map((center) => `<option value="${center.id}">${escapeHtml(center.name)}</option>`).join("")}</select>`
    : "";
  return `<form id="accountCreateForm" class="op-form op-section">
    ${U.field("username", "아이디")}${U.field("name", "이름")}${U.field("email", "연락 이메일 (선택)", "", { type: "email", required: false })}
    <label class="op-field">역할<select name="role">${accountRoleOptions("MEMBER")}</select></label>
    ${centerField ? `<label class="op-field">센터${centerField}</label>` : ""}
    ${U.field("password", "임시 비밀번호", "", { type: "password", max: 256 })}${U.field("password_confirm", "비밀번호 확인", "", { type: "password", max: 256 })}
    <button>계정 생성</button>
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
    await reloadManagedAccounts();
    state.accountsMessage = "계정 권한을 저장했습니다.";
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
    state.accountsMessage = "비밀번호 확인이 일치하지 않습니다.";
    $("#accountsMessage").textContent = state.accountsMessage;
    return;
  }
  pendingAccountWrites.add("create");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/admin/accounts", { method: "POST", body: JSON.stringify(body) });
    await reloadManagedAccounts();
    state.showAccountCreateForm = false;
    state.accountsMessage = "새 계정을 생성했습니다.";
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
