(function (root) {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const money = value => root.BoxingI18n?.language === "en" ? `KRW ${Number(value || 0).toLocaleString("en-US")}` : `${Number(value || 0).toLocaleString("ko-KR")}원`;
  const labels = { ACTIVE: "유효", PAUSED: "휴회", CANCELLED: "취소", EXPIRED: "만료", UPCOMING: "시작 전", SUSPENDED: "정지", UNCONNECTED: "계정 미연결", PRESENT: "출석", PAID: "수납", UNPAID: "미납", PARTIAL_REFUND: "부분 환불 기록", REFUNDED: "환불 기록", PERIOD: "기간권", COUNT: "횟수권", TRIAL: "체험권", CARD: "카드", CASH: "현금", TRANSFER: "계좌 이체", KAKAOPAY: "카카오페이", EASY_PAY: "기타 간편결제" };
  const label = value => t(value === "UNKNOWN" ? "확인 불가" : value === "UNAVAILABLE" ? "연결 준비 중" : labels[value] || value || "확인 불가");
  const badge = value => ["PAUSED", "UPCOMING", "NONE"].includes(value) ? "—" : `<span class="op-badge" data-tone="${escape(value)}">${escape(label(value))}</span>`;
  function roster(data, selected) {
    if (data.roster?.date === selected) return data.roster;
    const present = new Set(data.attendance.filter(row => row.visited_on === selected && row.status === "PRESENT").map(row => row.member_id));
    const members = data.members.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.joined_on || "") && row.joined_on <= selected && (!row.deleted_on || row.deleted_on > selected)).map(row => ({ ...row, attendance_status: selected > data.referenceDate ? "UPCOMING" : present.has(row.id) ? "PRESENT" : "ABSENT" }));
    return { date: selected, members, total: members.length, present: members.filter(row => row.attendance_status === "PRESENT").length, absent: members.filter(row => row.attendance_status === "ABSENT").length, unknown_registration_count: data.members.filter(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.joined_on || "")).length };
  }
  function revenueMonths(data) {
    if (data.revenue) return data.revenue;
    const [year, month] = data.referenceDate.split("-").map(Number);
    const months = Array.from({ length: 6 }, (_, index) => ({ month: new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7), collected: 0, refunded: 0, net: 0 }));
    const add = (on, field, amount) => {
      const bucket = on && on <= data.referenceDate && months.find(row => row.month === on.slice(0, 7));
      if (bucket) bucket[field] += amount;
    };
    data.payments.forEach(payment => {
      if (!payment.paid_on) return;
      add(payment.paid_on, "collected", payment.amount);
      payment.adjustments.forEach(item => add(item.on, "refunded", item.action === "CANCEL" ? payment.amount : item.amount));
    });
    return months.map(row => ({ ...row, net: row.collected - row.refunded }));
  }
  const button = (action, title, value = "", style = "") => `<button type="button" class="${escape(style)}" data-action="${escape(action)}" data-id="${escape(value)}">${escape(title)}</button>`;
  function field(name, title, value = "", options = {}) {
    const attributes = `name="${escape(name)}" ${options.required === false ? "" : "required"} ${options.readonly ? "readonly" : ""}`;
    let input;
    if (options.options) input = `<select ${attributes}>${options.options.map(([id, caption]) => `<option value="${escape(id)}" ${String(value) === String(id) ? "selected" : ""}>${escape(caption)}</option>`).join("")}</select>`;
    else if (options.multiline) input = `<textarea ${attributes} maxlength="${options.max || 2000}" rows="4">${escape(value)}</textarea>`;
    else input = `<input ${attributes} type="${escape(options.type || "text")}" value="${escape(value)}" ${options.type === "number" ? `min="${options.min ?? 0}" step="1"` : `maxlength="${options.max || 120}"`}>`;
    return `<label class="op-field"><span>${escape(title)}</span>${input}${options.hint ? `<small>${escape(options.hint)}</small>` : ""}</label>`;
  }
  function table(headers, rows, empty = t("등록된 내역이 없습니다.")) {
    return `<div class="op-table-scroll" tabindex="0" role="region" aria-label="${escape(t("{headers} 목록", { headers: headers.join(", ") }))}"><table><thead><tr>${headers.map(item => `<th scope="col">${escape(item)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="op-empty">${escape(empty)}</td></tr>`}</tbody></table></div>`;
  }
  function passStatus(pass, referenceDate) {
    if (pass.status !== "ACTIVE") return pass.status;
    if (pass.end_on < referenceDate || pass.remaining === 0) return "EXPIRED";
    if (pass.start_on > referenceDate) return "UPCOMING";
    return "ACTIVE";
  }
  function filterRows(rows, { search = "", text: toText = row => row.name, page = 1, size = 10, compare } = {}) {
    const query = search.trim().toLocaleLowerCase();
    const filtered = rows.filter(row => String(toText(row) || "").toLocaleLowerCase().includes(query));
    if (compare) filtered.sort(compare);
    const pages = Math.max(1, Math.ceil(filtered.length / size));
    const current = Math.min(Math.max(1, page), pages);
    return { rows: filtered.slice((current - 1) * size, current * size), total: filtered.length, page: current, pages };
  }
  const pagination = ({ total, page, pages }) => `<div class="op-pagination"><span>${t("총 {total}건 · {page} / {pages}페이지", { total, page, pages })}</span><button data-action="page" data-id="${page - 1}" ${page === 1 ? "disabled" : ""}>${t("이전")}</button><button data-action="page" data-id="${page + 1}" ${page === pages ? "disabled" : ""}>${t("다음")}</button></div>`;

  function modal({ title, content, submitLabel = t("저장"), save, onSaved }) {
    const previous = document.activeElement;
    const previousAction = previous?.dataset.action;
    const previousId = previous?.dataset.id;
    const restoreFocus = () => {
      const replacement = [...document.querySelectorAll("[data-action]")].find(item => item.dataset.action === previousAction && item.dataset.id === previousId);
      const target = previous?.isConnected ? previous : (previous?.id && document.getElementById(previous.id)) || replacement || document.querySelector('#opMain h1, #viewTitle');
      if (target) { if (target.matches("h1,h2")) target.tabIndex = -1; target.focus(); }
    };
    const dialog = document.createElement("dialog");
    dialog.className = "operations op-dialog";
    dialog.dataset.theme = document.body.dataset.theme || document.documentElement.dataset.theme || "dark";
    dialog.setAttribute("aria-labelledby", "op-dialog-title");
    dialog.innerHTML = `<form><header><h2 id="op-dialog-title">${escape(title)}</h2><button type="button" data-close aria-label="${t("닫기")}">×</button></header><div class="op-form">${content}</div><p role="alert" class="op-error"></p><footer><button type="button" data-close>${t("취소")}</button><button type="submit" class="op-primary">${escape(submitLabel)}</button></footer></form>`;
    document.body.append(dialog);
    let busy = false;
    const requestId = crypto.randomUUID();
    dialog.querySelectorAll("[data-close]").forEach(item => item.addEventListener("click", () => { if (!busy) dialog.close(); }));
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { dialog.remove(); restoreFocus(); }, { once: true });
    dialog.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const controls = [...dialog.querySelectorAll("button")];
      controls.forEach(item => { item.disabled = true; });
      dialog.setAttribute("aria-busy", "true");
      const errorBox = dialog.querySelector(".op-error");
      errorBox.textContent = t("저장 중…");
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const result = await save(values, requestId);
        await onSaved?.(result);
        dialog.close();
      } catch (error) {
        errorBox.textContent = t(error.message || "저장하지 못했습니다. 입력을 확인한 뒤 다시 시도하세요.");
      } finally {
        busy = false; controls.forEach(item => { item.disabled = false; }); dialog.removeAttribute("aria-busy");
      }
    });
    dialog.showModal();
    return dialog;
  }
  root.OperationsUI = Object.freeze({ escape, money, label, badge, button, field, table, filterRows, pagination, passStatus, modal, roster, revenueMonths });
})(window);
