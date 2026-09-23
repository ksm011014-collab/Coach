function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCenterCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function isValidPassword(value) {
  return String(value || "").length >= 8 && /[^A-Za-z0-9]/.test(value);
}

function memberTrainingLevel(member) {
  const value = Number(member?.training_level || 1);
  return Number.isFinite(value) ? Math.max(1, Math.min(5, Math.round(value))) : 1;
}

function memberLevelLabel(member) {
  return `LV ${memberTrainingLevel(member)}`;
}

function memberReachLabel(member) {
  return Number(member?.reach_cm || 0) > 0 ? `${member.reach_cm}cm` : "-";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}


function formatDateTime(seconds) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString(BoxingI18n.language === 'en' ? 'en-US' : 'ko-KR', {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startSeconds, endSeconds) {
  return elapsedText(startSeconds, endSeconds);
}

function elapsedText(startSeconds, endSeconds) {
  const elapsed = Math.max(0, Math.floor(endSeconds - startSeconds));
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
