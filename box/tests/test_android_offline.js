const assert = require("node:assert/strict");
const crypto = require("node:crypto").webcrypto;
const fs = require("node:fs");
const vm = require("node:vm");

const storage = new Map();
const context = {
  Headers,
  Response,
  TextEncoder,
  URL,
  console,
  crypto,
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  },
  location: { origin: "https://app.local" },
};
context.window = context;
context.BoxingCoachAndroid = { platform: () => "android" };
context.fetch = async () => {
  throw new Error("unexpected network request");
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("web/scripts/android-offline.js", "utf8"), context);

(async () => {
  const missing = await context.fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "owner", password: "Owner!123" }) });
  assert.equal(missing.status, 401, "empty device must not contain a seeded administrator");
  for (const [username, role] of [["owner", "OWNER"], ["member", "MEMBER"]]) {
    const response = await context.fetch("/api/auth/signup", { method: "POST", body: JSON.stringify({
      username, role, password: `${username === "owner" ? "Owner" : "Member"}!123`,
      password_confirm: `${username === "owner" ? "Owner" : "Member"}!123`, name: username,
      center_name: "Test Center", center_code: "test-center",
    }) });
    assert.equal(response.status, 201);
  }
  const loginResponse = await context.fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "owner", password: "Owner!123" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.username, "owner");
  const forged = await context.fetch("/api/me", { headers: { Authorization: `Bearer android:${login.user.id}` } });
  assert.equal(forged.status, 401);
  const escalated = await context.fetch("/api/auth/signup", { method: "POST", body: JSON.stringify({
    username: "intruder", role: "PLATFORM_ADMIN", password: "Test!123", password_confirm: "Test!123", center_code: "test-center",
  }) });
  assert.equal(escalated.status, 403);

  const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
  const me = await (await context.fetch("/api/me", { headers })).json();
  assert.equal(me.user.role, "OWNER");

  const members = await (await context.fetch("/api/members", { headers })).json();
  const member = members.members.find((item) => item.username === "member");
  assert.ok(member);
  const memberLogin = await (await context.fetch('/api/auth/login', {method:'POST',body:JSON.stringify({username:'member',password:'Member!123'})})).json();
  const memberHeaders = {Authorization:`Bearer ${memberLogin.token}`};
  for(const field of ['reach_cm','training_level']) {
    assert.equal((await context.fetch(`/api/members/${member.id}`, {method:'PATCH',headers:memberHeaders,body:JSON.stringify({[field]:2})})).status,403);
  }
  assert.equal((await context.fetch(`/api/members/${member.id}`, {method:'PATCH',headers:memberHeaders,body:'{"phone":"123"}'})).status,200);
  for(const patch of [{height_cm:true},{birthdate:'2026-02-30'},{name:' '},{gym_id:'other'}]) {
    assert.equal((await context.fetch(`/api/members/${member.id}`, {method:'PATCH',headers,body:JSON.stringify(patch)})).status,400);
  }

  const createdResponse = await context.fetch("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: member.user_id,
      request_id: "android-start-retry",
      camera_config: [{ camera_id: "tablet_camera", view_angle: "front", enabled: true, calibrated: true, projection_matrix: [1] }],
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.session.user_id, member.user_id);
  assert.equal(created.session.camera_config[0].calibrated, undefined);
  assert.equal(created.session.camera_config[0].projection_matrix, undefined);
  const repeatBody = { user_id: member.user_id, request_id: "android-start-retry", camera_config: created.session.camera_config };
  const repeatedResponse = await context.fetch("/api/sessions", { method: "POST", headers, body: JSON.stringify(repeatBody) });
  assert.equal(repeatedResponse.status, 200);
  assert.equal((await repeatedResponse.json()).session.id, created.session.id);
  const conflicting = await context.fetch("/api/sessions", { method: "POST", headers, body: JSON.stringify({ ...repeatBody, focus: "changed" }) });
  assert.equal(conflicting.status, 409);
  assert.equal((await (await context.fetch("/api/sessions", { headers })).json()).sessions.length, 1);

  const endedResponse = await context.fetch(`/api/sessions/${created.session.id}/end`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ overall_score: 91, feedback_report: "guard stable" }),
  });
  const ended = await endedResponse.json();
  assert.equal(ended.session.overall_score, 0);
  assert.equal(ended.session.feedback_report, "");
  assert.ok(ended.session.ended_at);
  const retried = await (await context.fetch(`/api/sessions/${created.session.id}/end`, { method: "PATCH", headers, body: "{}" })).json();
  assert.equal(retried.session.ended_at, ended.session.ended_at);

  for (const [method, route] of [["GET", "/system/pose3d"], ["POST", "/pose/3d"], ["POST", "/calibration/human"], ["GET", `/members/${member.id}/calibration`], ["POST", `/members/${member.id}/calibration`]]) {
    const response = await context.fetch(`/api${route}`, { method, headers, body: method === "POST" ? "{}" : undefined });
    assert.equal(response.status, 404);
  }

  await context.fetch("/api/auth/logout", { method: "POST", headers, body: "{}" });
  assert.equal((await context.fetch("/api/me", { headers })).status, 401);
  const stored = JSON.parse(storage.get("boxing_android_database_v1"));
  assert.ok(stored.users.every(user => user.password_hash.startsWith("pbkdf2:")));
  storage.set("boxing_android_database_v1", "broken stored data");
  assert.equal((await context.fetch("/api/me", { headers })).status, 503);
  assert.equal(storage.get("boxing_android_database_v1"), "broken stored data");
  console.log("Android offline API and authentication safety flow passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
