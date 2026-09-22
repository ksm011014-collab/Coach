const PLATFORM_FEATURE_PRESETS = [
  ["web.beta", "새 웹 화면 시험 사용"],
  ["pwa.enabled", "웹앱 설치 기능"],
];

const PLATFORM_VALUE_LABELS = {
  ACTIVE: "이용 중",
  SUSPENDED: "일시 정지",
  CLOSED: "운영 종료",
  TRIAL: "무료 체험",
  PAST_DUE: "결제 연체",
  CANCELED: "계약 취소",
  EXPIRED: "계약 만료",
  STABLE: "정식 배포",
  BETA: "시험 배포",
  CENTER_CREATED: "체육관 생성",
  CENTER_UPDATED: "체육관 정보 변경",
  SUBSCRIPTION_UPDATED: "계약 정보 변경",
  FEATURE_FLAG_UPDATED: "기능 설정 변경",
  ACCOUNT_ACCESS_UPDATED: "계정 권한 변경",
  CENTER: "체육관",
  SUBSCRIPTION: "이용 계약",
  FEATURE_FLAG: "기능 설정",
  ACCOUNT: "계정",
};

const PLATFORM_PLAN_LABELS = {
  starter: "기본 요금제",
  pro: "프로 요금제",
  legacy: "기존 계약",
};

function renderPlatformOperations() {
  if (state.user?.role !== "PLATFORM_ADMIN") {
    $("#viewContent").innerHTML = `<section class="admin-board"><p>${t("플랫폼 관리자 권한이 필요합니다.")}</p></section>`;
    return;
  }

  const search = state.platformCenterSearch.trim().toLowerCase();
  const centers = state.platformCenters.filter((center) => {
    if (!search) return true;
    return `${center.name} ${center.code} ${center.plan_code}`.toLowerCase().includes(search);
  });
  const selected = state.platformCenters.find((center) => center.id === state.selectedPlatformCenterId)
    || state.platformCenters[0]
    || null;
  if (selected && selected.id !== state.selectedPlatformCenterId) {
    state.selectedPlatformCenterId = selected.id;
  }

  $("#viewContent").innerHTML = `<section class="platform-ops-layout">
    <section class="admin-board platform-center-list">
      <div class="section-heading">
        <div><span>${t("중앙 운영")}</span><h3>${t("체육관 중앙 관제")}</h3></div>
        <button id="togglePlatformCenterCreate">${state.showPlatformCenterCreateForm ? t("닫기") : t("체육관 추가")}</button>
      </div>
      <p class="form-message">${escapeHtml(state.platformMessage || t("체육관 상태와 계약 변경은 다음 인증 요청부터 적용됩니다."))}</p>
      ${state.showPlatformCenterCreateForm ? platformCenterCreateForm() : ""}
      <label class="platform-search"><span>${t("검색")}</span><input id="platformCenterSearch" value="${escapeHtml(state.platformCenterSearch)}" placeholder="${t("체육관명, 코드, 요금제")}" /></label>
      <div class="table-scroll"><table class="admin-table platform-center-table">
        <thead><tr><th>${t("체육관")}</th><th>${t("운영 상태")}</th><th>${t("이용 계약")}</th><th>${t("등록 인원")}</th><th>${t("최근 활동")}</th></tr></thead>
        <tbody>${centers.map(platformCenterRow).join("") || `<tr><td colspan="5">${t("표시할 체육관이 없습니다.")}</td></tr>`}</tbody>
      </table></div>
    </section>
    ${selected ? platformCenterDetail(selected) : `<section class="admin-board"><p>${t("먼저 체육관을 생성하세요.")}</p></section>`}
    <section class="admin-board platform-audit-panel">
      <div class="section-heading"><div><span>${t("변경 이력")}</span><h3>${t("관리자 작업 기록")}</h3></div></div>
      ${platformAuditTable(selected?.id || "")}
    </section>
  </section>`;

  bindPlatformOperationEvents(selected);
}

function platformCenterRow(center) {
  const selected = center.id === state.selectedPlatformCenterId;
  const people = Number(center.owner_count || 0) + Number(center.coach_count || 0) + Number(center.member_count || 0);
  return `<tr class="platform-center-row ${selected ? "selected" : ""}" data-platform-center="${center.id}">
    <td><strong>${escapeHtml(center.name)}</strong><small class="table-subline">${escapeHtml(center.code)}</small></td>
    <td><span class="status-pill ${String(center.status).toLowerCase()}">${escapeHtml(platformValueLabel(center.status))}</span></td>
    <td><strong>${escapeHtml(platformPlanLabel(center.plan_code))}</strong><small class="table-subline">${escapeHtml(platformValueLabel(center.subscription_status))}</small></td>
    <td>${t("{count}명", { count: people })}<small class="table-subline">${t("관장 {owners} · 코치 {coaches} · 회원 {members}", { owners: Number(center.owner_count || 0), coaches: Number(center.coach_count || 0), members: Number(center.member_count || 0) })}</small></td>
    <td><span>${t("접속 {date}", { date: formatPlatformDate(center.last_login_at) })}</span><small class="table-subline">${t("운동 {date}", { date: formatPlatformDate(center.last_session_at) })}</small></td>
  </tr>`;
}

function platformCenterDetail(center) {
  return `<section class="admin-board platform-center-detail">
    <div class="section-heading">
      <div><span>${t("체육관 상세 정보")}</span><h3>${escapeHtml(center.name)}</h3></div>
      <span class="status-pill ${String(center.status).toLowerCase()}">${escapeHtml(platformValueLabel(center.status))}</span>
    </div>
    <form id="platformCenterForm" class="center-form-grid compact">
      <label class="center-field"><span>${t("체육관명")}</span><input name="name" value="${escapeHtml(center.name)}" required /></label>
      <label class="center-field"><span>${t("체육관 코드")}</span><input name="code" value="${escapeHtml(center.code)}" required /></label>
      <label class="center-field"><span>${t("운영 상태")}</span><select name="status">${optionsFor(["ACTIVE", "SUSPENDED", "CLOSED"], center.status)}</select></label>
      <div class="center-actions"><button>${t("센터 정보 저장")}</button></div>
    </form>
    <form id="platformSubscriptionForm" class="center-form-grid compact platform-contract-form">
      <label class="center-field"><span>${t("요금제")}</span><input name="plan_code" value="${escapeHtml(center.plan_code || "starter")}" required /></label>
      <label class="center-field"><span>${t("계약 상태")}</span><select name="status">${optionsFor(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED", "EXPIRED"], center.subscription_status)}</select></label>
      <label class="center-field"><span>${t("시작일")}</span><input name="starts_at" type="date" value="${escapeHtml(center.starts_at || "")}" required /></label>
      <label class="center-field"><span>${t("종료일")}</span><input name="ends_at" type="date" value="${escapeHtml(center.ends_at || "")}" /></label>
      <label class="center-field"><span>${t("최대 회원 수")}</span><input name="max_members" type="number" min="1" value="${escapeHtml(center.max_members || "")}" /></label>
      <div class="center-actions"><button>${t("계약 정보 저장")}</button></div>
    </form>
    ${platformFeatureFlags(center)}
    <p class="platform-owner-hint">${t("관장 지정과 계정 생성은 ‘계정 권한’ 메뉴에서 이 체육관을 선택해 진행합니다.")}</p>
  </section>`;
}

function platformFeatureFlags(center) {
  const flags = new Map(state.platformFeatureFlags.map((flag) => [flag.flag_key, flag]));
  return `<section class="platform-feature-panel">
    <div class="section-heading"><div><span>${t("기능 배포 관리")}</span><h3>${t("체육관별 기능 설정")}</h3></div></div>
    <p>${t("현재 설정은 저장만 지원합니다. 웹 화면과 설치 가능 여부에는 아직 적용되지 않습니다.")}</p>
    <div class="platform-feature-list">${PLATFORM_FEATURE_PRESETS.map(([key, label]) => {
      const flag = flags.get(key) || { flag_key: key, enabled: false, rollout_channel: "STABLE" };
      return `<form class="platform-feature-row" data-feature-key="${key}">
        <label><input name="enabled" type="checkbox" ${flag.enabled ? "checked" : ""} /><span><strong>${escapeHtml(t(label))}</strong><small>${t("관리 코드:")} ${escapeHtml(key)}</small></span></label>
        <select name="rollout_channel">${optionsFor(["STABLE", "BETA"], flag.rollout_channel)}</select>
        <button class="ghost small-button">${t("저장")}</button>
      </form>`;
    }).join("")}</div>
  </section>`;
}

function platformCenterCreateForm() {
  return `<form id="platformCenterCreateForm" class="member-create-form platform-create-form">
    <input name="name" placeholder="${t("체육관명")}" required />
    <input name="code" placeholder="${t("체육관 코드")}" pattern="[a-z0-9_-]{3,24}" required />
    <input name="plan_code" value="starter" placeholder="${t("요금제")}" required />
    <select name="subscription_status">${optionsFor(["TRIAL", "ACTIVE"], "TRIAL")}</select>
    <input name="starts_at" type="date" value="${new Date().toISOString().slice(0, 10)}" required />
    <input name="ends_at" type="date" />
    <button>${t("체육관 생성")}</button>
  </form>`;
}

function platformAuditTable(centerId) {
  const logs = state.platformAuditLogs
    .filter((log) => !centerId || log.center_id === centerId)
    .slice(0, 50);
  return `<div class="table-scroll"><table class="admin-table platform-audit-table">
    <thead><tr><th>${t("처리 시간")}</th><th>${t("작업 내용")}</th><th>${t("대상 항목")}</th><th>${t("처리자")}</th></tr></thead>
    <tbody>${logs.map((log) => `<tr>
      <td>${formatPlatformDate(log.created_at)}</td>
      <td>${escapeHtml(platformValueLabel(log.action))}</td>
      <td>${escapeHtml(platformValueLabel(log.target_type))} · ${escapeHtml(platformTargetLabel(log.target_id))}</td>
      <td>${escapeHtml(log.actor_id === state.user?.id ? state.user.name : log.actor_id)}</td>
    </tr>`).join("") || `<tr><td colspan="4">${t("감사 기록이 없습니다.")}</td></tr>`}</tbody>
  </table></div>`;
}

function bindPlatformOperationEvents(selected) {
  $("#togglePlatformCenterCreate").addEventListener("click", () => {
    state.showPlatformCenterCreateForm = !state.showPlatformCenterCreateForm;
    state.platformMessage = "";
    renderPlatformOperations();
  });
  $("#platformCenterSearch").addEventListener("input", (event) => {
    state.platformCenterSearch = event.target.value;
    renderPlatformOperations();
  });
  document.querySelectorAll("[data-platform-center]").forEach((row) => {
    row.addEventListener("click", async () => {
      state.selectedPlatformCenterId = row.dataset.platformCenter;
      await reloadPlatformFeatures();
      renderPlatformOperations();
    });
  });
  const createForm = $("#platformCenterCreateForm");
  if (createForm) createForm.addEventListener("submit", createPlatformCenter);
  const centerForm = $("#platformCenterForm");
  if (centerForm && selected) centerForm.addEventListener("submit", (event) => savePlatformCenter(event, selected));
  const subscriptionForm = $("#platformSubscriptionForm");
  if (subscriptionForm && selected) subscriptionForm.addEventListener("submit", (event) => savePlatformSubscription(event, selected));
  document.querySelectorAll("[data-feature-key]").forEach((form) => {
    form.addEventListener("submit", (event) => savePlatformFeature(event, selected));
  });
}

async function createPlatformCenter(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/admin/centers", { method: "POST", body: JSON.stringify(body) });
    state.selectedPlatformCenterId = result.center.id;
    state.showPlatformCenterCreateForm = false;
    state.platformMessage = t("체육관을 생성했습니다. 계정 권한 메뉴에서 관장을 지정하세요.");
    await reloadPlatformOperations();
  } catch (error) {
    state.platformMessage = error.message;
    renderPlatformOperations();
  }
}

async function savePlatformCenter(event, center) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (body.status !== "ACTIVE" && body.status !== center.status) {
    const confirmed = window.confirm(t("{name}의 운영 상태를 '{status}'(으)로 변경할까요? 소속 사용자의 다음 요청부터 접근이 제한될 수 있습니다.", { name: center.name, status: platformValueLabel(body.status) }));
    if (!confirmed) return;
  }
  await runPlatformMutation(
    `/admin/centers/${center.id}`,
    "PATCH",
    body,
    t("체육관 정보를 저장했습니다."),
  );
}

async function savePlatformSubscription(event, center) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!["TRIAL", "ACTIVE"].includes(body.status) && body.status !== center.subscription_status) {
    const confirmed = window.confirm(t("{name}의 계약 상태를 '{status}'(으)로 변경할까요?", { name: center.name, status: platformValueLabel(body.status) }));
    if (!confirmed) return;
  }
  await runPlatformMutation(
    `/admin/centers/${center.id}/subscription`,
    "PATCH",
    body,
    t("계약 정보를 저장했습니다."),
  );
}

async function savePlatformFeature(event, center) {
  event.preventDefault();
  if (!center) return;
  const form = event.currentTarget;
  const body = {
    enabled: form.elements.enabled.checked,
    rollout_channel: form.elements.rollout_channel.value,
    config: {},
  };
  await runPlatformMutation(
    `/admin/centers/${center.id}/features/${encodeURIComponent(form.dataset.featureKey)}`,
    "PUT",
    body,
    t("기능 플래그를 저장했습니다."),
  );
}

async function runPlatformMutation(path, method, body, successMessage) {
  try {
    await api(path, { method, body: JSON.stringify(body) });
    state.platformMessage = successMessage;
    await reloadPlatformOperations();
  } catch (error) {
    state.platformMessage = error.message;
    renderPlatformOperations();
  }
}

async function reloadPlatformOperations() {
  const [centers, auditLogs] = await Promise.all([
    api("/admin/centers"),
    api("/admin/audit-logs?limit=100"),
  ]);
  state.platformCenters = centers.centers || [];
  state.platformAuditLogs = auditLogs.audit_logs || [];
  await reloadPlatformFeatures();
  renderPlatformOperations();
}

async function reloadPlatformFeatures() {
  if (!state.selectedPlatformCenterId) {
    state.platformFeatureFlags = [];
    return;
  }
  const result = await api(`/admin/centers/${state.selectedPlatformCenterId}/features`);
  state.platformFeatureFlags = result.feature_flags || [];
}

function optionsFor(values, selected) {
  return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(platformValueLabel(value))}</option>`).join("");
}

function platformValueLabel(value) {
  if (!value) return "-";
  return PLATFORM_VALUE_LABELS[value] ? t(PLATFORM_VALUE_LABELS[value]) : value;
}

function platformPlanLabel(value) {
  if (!value) return "-";
  return PLATFORM_PLAN_LABELS[String(value).toLowerCase()] ? t(PLATFORM_PLAN_LABELS[String(value).toLowerCase()]) : value;
}

function platformTargetLabel(value) {
  const label = PLATFORM_FEATURE_PRESETS.find(([key]) => key === value)?.[1];
  return label ? t(label) : value || "-";
}

function formatPlatformDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString(BoxingI18n.language === "en" ? "en-US" : "ko-KR", { dateStyle: "short", timeStyle: "short" });
}
