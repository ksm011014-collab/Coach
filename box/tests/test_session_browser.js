/* Run from box/ with Playwright installed and BOXING_COACH_PYTHON set if needed.
   Chromium's synthetic camera is used only by this test; application code has no simulated results. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { stopTestServer } = require("./browser_fixture");

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
        if (match) { const ready = JSON.parse(match[1]); server.workerPid = ready.pid; clearTimeout(timeout); resolve(ready.url); }
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
    if (process.env.BOXING_COACH_TEST_DISABLE_MOTION==='1') await page.route('**/vendor/motion/manifest.json',route=>route.fulfill({status:404,body:''}));
    const performanceSeconds = Number(process.env.BOXING_COACH_PERFORMANCE_SECONDS || 0);
    if (performanceSeconds) await require('../tools/session_performance.cjs').installProbe(page);
    if (process.env.BOXING_COACH_TEST_POSE_DELEGATE) {
      await page.route('**/vendor/motion/manifest.json', async route => {
        const response = await route.fetch();
        const config = await response.json();
        config.delegate = process.env.BOXING_COACH_TEST_POSE_DELEGATE;
        await route.fulfill({ response, json: config });
      });
    }
    const errors = [];
    const unexpectedAnalysisRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && message.text() !== 'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.') errors.push(message.text()); });
    page.on("request", request => {
      if (/calibrat|pose\/|pose3d|mediapipe|feedback\.js|session-pose/.test(request.url())) unexpectedAnalysisRequests.push(request.url());
    });
    await page.goto(url);
    await page.locator('[name="username"]').fill("owner");
    await page.locator('[name="password"]').fill("Owner!123");
    await page.locator("#authSubmit").click();
    await page.locator("#sidebar").waitFor({ state: "visible" });
    if (process.env.BOXING_COACH_TEST_RECORDING_MIME) {
      await page.evaluate(mimeType => {
        if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error(`Unsupported test recording codec: ${mimeType}`);
        preferredRecordingOptions = () => ({ mimeType });
      }, process.env.BOXING_COACH_TEST_RECORDING_MIME);
    }
    for (const view of ["dashboard", "members", "center", "staff", "attendance", "settings", "coach"]) {
      await page.locator(`[data-view="${view}"]`).click();
    }
    await page.locator("#retryCamera").click();
    try { await page.waitForFunction(() => document.querySelector("#cameraPreview").videoWidth > 0 && !state.sessionBusy); }
    catch (error) {
      console.error(await page.evaluate(() => ({ camera: state.cameraMessage, session: document.querySelector("#sessionMessage").textContent, devices: state.videoDevices.length, busy: state.sessionBusy, stream: Boolean(document.querySelector("#cameraPreview").srcObject) })));
      throw error;
    }
    assert.equal(await page.evaluate(() => state.activeSessionId), "");
    await page.evaluate(() => { window.testPreviewStream = state.recordingStream; });
    if (performanceSeconds) await page.evaluate(seconds=>{sessionDurationSecondsFromCenter=()=>seconds+30;},performanceSeconds);
    if (performanceSeconds) console.log(JSON.stringify(await page.evaluate(()=>({cameraReuse:{cached:sessionCameraConfigKey,current:JSON.stringify(activeCameraConfig()),sources:state.sessionCameraSources.map(source=>({width:source.video.videoWidth,tracks:source.stream.getVideoTracks().map(track=>({ready:track.readyState,muted:track.muted}))}))}}))));
    await page.locator("#startSessionHud").click();
    try { await page.waitForFunction(() => state.activeSessionId && !state.sessionBusy); }
    catch (error) {
      console.error(await page.evaluate(async () => ({ session: document.querySelector("#sessionMessage").textContent, busy: state.sessionBusy, sources: state.sessionCameraSources.length,
        config:activeCameraConfig(),pending:state.pendingSessionStart?.body.camera_config,
        previewTracks:window.testPreviewStream?.getVideoTracks().map(track=>({ready:track.readyState,settings:track.getSettings()})),
        available:(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput').map(device=>({id:device.deviceId,label:device.label})) })));
      throw error;
    }
    const recorderState=await page.evaluate(()=>state.recorder?.state);
    if(recorderState!=='recording') console.error(await page.evaluate(()=>({recorder:state.recorder?.state,error:state.recordingError,message:document.querySelector('#sessionMessage').textContent,duration:sessionDurationSecondsFromCenter(),tracks:state.recordingStream?.getTracks().map(track=>({ready:track.readyState,muted:track.muted}))})));
    assert.equal(recorderState, "recording");
    assert.equal(await page.evaluate(() => state.recordingStream === window.testPreviewStream), true);
    const sessionId = await page.evaluate(() => state.activeSessionId);
    if (performanceSeconds) await require('../tools/session_performance.cjs').measureSession(page,performanceSeconds,process.env.BOXING_COACH_PERFORMANCE_OUTPUT || `artifacts/session-performance-${Date.now()}.json`);
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
    const motionReport = JSON.parse(result.session.feedback_report);
    assert.equal(motionReport.status, 'unavailable');
    assert.equal(motionReport.total_points, 0);
    assert.equal(motionReport.mean_quality, null);
    assert.deepEqual(motionReport.events, []);
    assert.ok(motionReport.duration_ms > 0);
    if (performanceSeconds) {
      assert.ok(motionReport.tracking.total_ms>0);
      await page.locator('#roundCoachDialog').waitFor({state:'visible'});
      console.log('Live generated stream performance, round persistence and popup passed; recorded-video playback excluded.');
      return;
    }
    assert.ok(result.recordingSize > 0);
    const decoded = await page.evaluate(async id => {
      const video = document.createElement("video");
      video.muted = true;
      const url = URL.createObjectURL(state.localRecordings[id].blob);
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Saved recording could not be decoded")), 10000);
          video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
          video.onerror = () => { clearTimeout(timeout); reject(new Error("Invalid saved recording")); };
          video.src = url;
        });
        return video.videoWidth > 0 && video.videoHeight > 0;
      } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
    }, sessionId);
    assert.equal(decoded, true, "A positive blob size alone does not prove a playable recording");
    assert.ok(result.previewStopped);
    assert.deepEqual(await page.evaluate(async () => Object.keys(await loadLocalRecordings())), [sessionId]);
    console.log("Camera capture and recording persistence passed.");
    await page.locator('#roundCoachDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#startSessionHud').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#roundCoachDialog').isVisible(), true);
    await page.locator('[data-coach-close]').click();
    await page.locator('[data-round-finish]').click();
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
    try {
      await page.waitForFunction(() => state.recordedChunks.some(chunk => chunk.size > 0));
    } catch (error) {
      console.error(await page.evaluate(() => ({ recorder: state.recorder?.state, recordingError: state.recordingError, motion: document.querySelector('#motionStatus')?.textContent, videoReady: document.querySelector('#cameraPreview').readyState, tracks: state.recordingStream?.getTracks().map(track => ({ state: track.readyState, muted: track.muted })) })));
      console.error(errors);
      throw error;
    }
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
    await page.locator('[data-coach-close]').click();
    await page.locator('[data-round-next]').click();
    await page.waitForFunction(() => state.activeSessionId && !state.sessionBusy);
    const disconnectedSession = await page.evaluate(() => state.activeSessionId);
    try { await page.waitForFunction(() => state.recordedChunks.some(chunk => chunk.size > 0)); }
    catch (error) {
      console.error(await page.evaluate(() => ({recorder:state.recorder?.state,mime:state.recorder?.mimeType,
        tracks:state.recordingStream?.getTracks().map(track=>({state:track.readyState,muted:track.muted})),
        quality:document.querySelector('#cameraPreview').getVideoPlaybackQuality(),
        motion:document.querySelector('#motionStatus').textContent,recordingError:state.recordingError})));
      throw error;
    }
    await page.evaluate(() => state.recordingStream.getTracks().forEach(track => track.stop()));
    await page.waitForFunction(() => state.recorder.state === "inactive");
    await page.locator("#stopSessionHud").click();
    await page.waitForFunction(() => !state.activeSessionId && !state.sessionBusy);
    const preserved = await page.evaluate(id => ({ size: state.localRecordings[id]?.size, interrupted: state.localRecordings[id]?.interrupted }), disconnectedSession);
    assert.ok(preserved.size > 0);
    assert.equal(preserved.interrupted, true);
    assert.match(await page.locator("#sessionMessage").innerText(), /중단 전 녹화/);
    await page.locator('[data-coach-close]').click();
    await page.locator('[data-round-finish]').click();
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
    console.log("Session retry, role rendering and camera denial passed; checking PWA.");
    const cachedContext = await browser.newContext();
    const cachedPage = await cachedContext.newPage();
    await cachedPage.goto(url);
    await cachedPage.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));
    const cachedPaths = await cachedPage.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const key = (await caches.keys()).find(value => value.startsWith("boxingcoach-shell-"));
      const cache = await caches.open(key);
      return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    assert.ok(cachedPaths.includes("/scripts/session.js"));
    assert.ok(cachedPaths.includes("/scripts/android-offline.js"));
    assert.ok(cachedPaths.includes("/scripts/operations-live.js"));
    assert.ok(cachedPaths.includes("/scripts/operations-views.js"));
    assert.ok(cachedPaths.includes("/scripts/operations-people.js"));
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
    await stopTestServer(server);
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      if (fs.existsSync(database + suffix)) fs.unlinkSync(database + suffix);
    }
    fs.rmdirSync(temporary);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
