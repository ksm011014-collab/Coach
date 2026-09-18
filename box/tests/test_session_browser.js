/* Run from box/ with Playwright installed and BOXING_COACH_PYTHON set if needed.
   Chromium's synthetic camera is used only by this test; application code has no simulated results. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "boxing-session-test-"));
  const database = path.join(temporary, "test.db");
  const server = spawn(process.env.BOXING_COACH_PYTHON || "python", ["-u", "backend/server.py"], {
    env: { ...process.env, BOXING_COACH_DATA_MODE: "local", BOXING_COACH_DB_PATH: database,
      BOXING_COACH_HOST: "127.0.0.1", BOXING_COACH_PORT: "0", BOXING_COACH_OPEN_BROWSER: "0" },
    windowsHide: true,
  });
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Server readiness timeout")), 10000);
      server.on("error", reject);
      server.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/BOXING_COACH_READY (.*)\r?\n/);
        if (match) { clearTimeout(timeout); resolve(JSON.parse(match[1]).url); }
      });
      server.stderr.on("data", () => {});
    });
    browser = await chromium.launch({
      channel: process.env.BOXING_COACH_BROWSER_CHANNEL || "chrome",
      headless: true,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    const context = await browser.newContext({ permissions: ["camera"], serviceWorkers: "block" });
    const ownerSignup = await context.request.post(`${url}/api/auth/signup`, { data: {
      role: "OWNER", username: "owner", password: "Owner!123", password_confirm: "Owner!123",
      name: "Test Owner", center_name: "Test Center", center_code: "test-center",
    } });
    assert.equal(ownerSignup.status(), 201);
    const page = await context.newPage();
    const errors = [];
    const unexpectedAnalysisRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", request => {
      if (/calibrat|pose\/|pose3d|mediapipe|feedback\.js|session-pose/.test(request.url())) unexpectedAnalysisRequests.push(request.url());
    });
    await page.goto(url);
    await page.locator('[name="username"]').fill("owner");
    await page.locator('[name="password"]').fill("Owner!123");
    await page.locator("#authSubmit").click();
    await page.locator("#sidebar").waitFor({ state: "visible" });
    for (const view of ["dashboard", "members", "center", "staff", "attendance", "settings", "coach"]) {
      await page.locator(`[data-view="${view}"]`).click();
    }
    await page.locator("#retryCamera").click();
    await page.waitForFunction(() => document.querySelector("#cameraPreview").videoWidth > 0 && !state.sessionBusy);
    assert.equal(await page.evaluate(() => state.activeSessionId), "");
    await page.locator("#startSessionHud").click();
    await page.waitForFunction(() => state.activeSessionId && !state.sessionBusy);
    assert.equal(await page.evaluate(() => state.recorder.state), "recording");
    const sessionId = await page.evaluate(() => state.activeSessionId);
    await page.waitForFunction(() => state.recordedChunks.some(chunk => chunk.size > 0));
    await page.locator("#stopSessionHud").click();
    await page.waitForFunction(() => !state.activeSessionId && !state.sessionBusy);
    const result = await page.evaluate(id => ({
      session: state.sessions.find(item => item.id === id),
      recordingSize: state.localRecordings[id]?.size,
      previewStopped: document.querySelector("#cameraPreview").srcObject === null,
    }), sessionId);
    assert.ok(result.session.ended_at);
    assert.equal(result.session.overall_score, 0);
    assert.equal(result.session.feedback_report, "");
    assert.ok(result.recordingSize > 0);
    assert.ok(result.previewStopped);
    assert.deepEqual(await page.evaluate(async () => Object.keys(await loadLocalRecordings())), [sessionId]);
    // Failed session writes must release the camera, and failed end writes must be retryable.
    await page.evaluate(() => {
      window.testOriginalApi = api;
      api = async (route, ...args) => {
        if (route === "/sessions") {
          await window.testOriginalApi(route, ...args);
          throw new Error("Test response lost after commit");
        }
        return window.testOriginalApi(route, ...args);
      };
    });
    await page.locator("#startSessionHud").click();
    await page.waitForFunction(() => !state.sessionBusy);
    assert.equal(await page.evaluate(() => state.activeSessionId), "");
    assert.equal(await page.evaluate(() => document.querySelector("#cameraPreview").srcObject), null);
    await page.evaluate(() => { api = window.testOriginalApi; });
    await page.evaluate(() => Promise.all([startSession(), startSession()]));
    assert.equal(await page.evaluate(() => state.sessions.length), 2);
    assert.equal(await page.evaluate(async () => (await api("/sessions")).sessions.length), 2);
    await page.waitForFunction(() => state.recordedChunks.some(chunk => chunk.size > 0));
    await page.evaluate(() => {
      api = async (route, ...args) => {
        if (route.endsWith("/end")) throw new Error("Test end unavailable");
        return window.testOriginalApi(route, ...args);
      };
    });
    await page.locator("#stopSessionHud").click();
    await page.waitForFunction(() => !state.sessionBusy);
    assert.ok(await page.evaluate(() => state.activeSessionId));
    assert.equal(await page.evaluate(() => document.querySelector("#cameraPreview").srcObject), null);
    await page.evaluate(() => { api = window.testOriginalApi; });
    await page.locator("#stopSessionHud").click();
    await page.waitForFunction(() => !state.activeSessionId && !state.sessionBusy);
    // Render every role's available views to catch dangling DOM/global references.
    await page.evaluate(() => {
      for (const role of ["PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"]) {
        state.user.role = role;
        for (const [view] of navigationForRole(role)) { state.activeView = view; renderApp(); }
      }
      state.user.role = "OWNER";
      state.activeView = "coach";
      renderApp();
    });
    // Camera failure must not create a training record or leak an active session.
    const beforeCount = await page.evaluate(() => state.sessions.length);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error("Test camera denied"); }; });
    await page.locator("#startSessionHud").click();
    await page.waitForFunction(() => !state.sessionBusy);
    assert.equal(await page.evaluate(() => state.sessions.length), beforeCount);
    assert.equal(await page.evaluate(() => state.activeSessionId), "");
    assert.match(await page.locator("#sessionMessage").innerText(), /Test camera denied/);
    assert.deepEqual(unexpectedAnalysisRequests, []);
    assert.deepEqual(errors, []);
    const cachedContext = await browser.newContext();
    const cachedPage = await cachedContext.newPage();
    await cachedPage.goto(url);
    const cachedPaths = await cachedPage.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const cache = await caches.open("boxingcoach-shell-2026-09-18-1");
      return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    assert.ok(cachedPaths.includes("/scripts/session.js"));
    assert.ok(cachedPaths.includes("/scripts/android-offline.js"));
    assert.ok(cachedPaths.includes("/scripts/operations-live.js"));
    assert.ok(cachedPaths.includes("/styles/operations.css"));
    assert.ok(cachedPaths.includes("/preview.html"));
    assert.ok(!cachedPaths.some(item => /feedback|session-pose|mediapipe/.test(item)));
    await cachedPage.goto(`${url}/preview.html?enable=1`);
    await cachedPage.getByRole("heading", { name: "운영 대시보드", exact: true }).waitFor();
    await cachedContext.setOffline(true);
    await cachedPage.goto(url);
    await cachedPage.locator("#loginForm").waitFor();
    await cachedPage.goto(`${url}/preview.html?enable=1`);
    await cachedPage.getByRole("heading", { name: "운영 대시보드", exact: true }).waitFor();
    await cachedContext.close();
    const logoutStatus = await page.evaluate(async () => {
      const oldToken = state.token;
      await logoutAuthSession();
      return (await fetch('/api/me', {headers:{Authorization:`Bearer ${oldToken}`}})).status;
    });
    assert.equal(logoutStatus, 401);
    console.log("Browser session flow passed: role views, preview, recording persistence, start/end, write retries, duplicate start guard, camera denial and PWA cache; no console errors or analysis requests.");
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once("exit", resolve)); }
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      if (fs.existsSync(database + suffix)) fs.unlinkSync(database + suffix);
    }
    fs.rmdirSync(temporary);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
