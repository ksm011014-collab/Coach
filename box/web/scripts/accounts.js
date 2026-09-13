function renderAccounts() {
  if (!roleCanManageAccounts(state.user?.role)) {
    $("#viewContent").innerHTML = `<section class="admin-board"><p>계정 관리 권한이 없습니다.</p></section>`;
    return;
  }

  const rows = state.accounts.map((account) => {
    const isSelf = account.id === state.user.id;
    return `<tr>
      <td><strong>${escapeHtml(account.name || account.username)}</strong><small class="table-subline">${escapeHtml(account.username)}</small></td>
      <td>${escapeHtml(account.center_name || "전체 센터")}</td>
      <td>
        <select data-account-role="${account.id}" ${isSelf ? "disabled" : ""}>
          ${accountRoleOptions(account.role)}
        </select>
      </td>
      <td>
        <select data-account-status="${account.id}" ${isSelf ? "disabled" : ""}>
          <option value="ACTIVE" ${account.status === "ACTIVE" ? "selected" : ""}>사용 중</option>
          <option value="SUSPENDED" ${account.status === "SUSPENDED" ? "selected" : ""}>정지</option>
        </select>
      </td>
      <td><button class="ghost small-button" data-save-account="${account.id}" ${isSelf ? "disabled" : ""}>권한 저장</button></td>
    </tr>`;
  }).join("");

  $("#viewContent").innerHTML = `<section class="accounts-layout">
    <section class="admin-board">
      <div class="section-heading">
        <div><span>ACCESS CONTROL</span><h3>계정 및 권한</h3></div>
        <button id="toggleAccountCreate">${state.showAccountCreateForm ? "닫기" : "계정 추가"}</button>
      </div>
      <p class="form-message">${escapeHtml(state.accountsMessage || "권한 변경과 계정 정지는 다음 서버 요청부터 적용됩니다.")}</p>
      ${state.showAccountCreateForm ? accountCreateForm() : ""}
      <div class="table-scroll"><table class="admin-table accounts-table">
        <thead><tr><th>계정</th><th>센터</th><th>역할</th><th>상태</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">표시할 계정이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </section>
  </section>`;

  $("#toggleAccountCreate").addEventListener("click", () => {
    state.showAccountCreateForm = !state.showAccountCreateForm;
    state.accountsMessage = "";
    renderAccounts();
  });
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
  const centers = uniqueAccountCenters();
  const centerField = state.user.role === "PLATFORM_ADMIN"
    ? `<select name="center_id"><option value="">센터 없음</option>${centers.map((center) => `<option value="${center.id}">${escapeHtml(center.name)}</option>`).join("")}</select>`
    : "";
  return `<form id="accountCreateForm" class="member-create-form account-create-form">
    <input name="username" placeholder="아이디" required />
    <input name="name" placeholder="이름" required />
    <input name="email" type="email" placeholder="연락 이메일(선택)" />
    <select name="role">${accountRoleOptions("MEMBER")}</select>
    ${centerField}
    <input name="password" type="password" placeholder="임시 비밀번호" required />
    <input name="password_confirm" type="password" placeholder="비밀번호 확인" required />
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
  }
  renderAccounts();
}

async function createManagedAccount(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (body.password !== body.password_confirm) {
    state.accountsMessage = "비밀번호 확인이 일치하지 않습니다.";
    renderAccounts();
    return;
  }
  try {
    await api("/admin/accounts", { method: "POST", body: JSON.stringify(body) });
    await reloadManagedAccounts();
    state.showAccountCreateForm = false;
    state.accountsMessage = "새 계정을 생성했습니다.";
  } catch (error) {
    state.accountsMessage = error.message;
  }
  renderAccounts();
}
