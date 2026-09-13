function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCenterCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function isValidPassword(value) {
  return String(value || "").length >= 8 && /[^A-Za-z0-9]/.test(value);
}
