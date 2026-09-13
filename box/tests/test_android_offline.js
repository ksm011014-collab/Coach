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
  const loginResponse = await context.fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "owner", password: "Owner!123" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.username, "owner");

  const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
  const me = await (await context.fetch("/api/me", { headers })).json();
  assert.equal(me.user.role, "OWNER");

  const members = await (await context.fetch("/api/members", { headers })).json();
  const member = members.members.find((item) => item.username === "member");
  assert.ok(member);

  const createdResponse = await context.fetch("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: member.user_id,
      camera_config: [{ camera_id: "tablet_camera", view_angle: "front", enabled: true }],
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.session.user_id, member.user_id);

  const endedResponse = await context.fetch(`/api/sessions/${created.session.id}/end`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ overall_score: 91, feedback_report: "guard stable" }),
  });
  const ended = await endedResponse.json();
  assert.equal(ended.session.overall_score, 91);
  assert.ok(ended.session.ended_at);

  console.log("Android offline API flow passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
