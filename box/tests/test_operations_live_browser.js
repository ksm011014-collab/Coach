const assert = require("node:assert/strict");
const fs = require("node:fs");
const { browserFixture } = require("./browser_fixture");
(async () => {
  const f = await browserFixture();
  const { page } = f;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const field = name => page.locator(`dialog [name="${name}"]`);
  try {
    await f.login();
    await page.locator('[data-view="members"]').click();
    await page.locator('[data-action="member-new"]').click();
    for (const [key, value] of Object.entries({ username: "liveflowmember", email: "test@example.invalid", password: "TestOnly!123", password_confirm: "TestOnly!123", name: "실제 API 합성 회원", phone: "010-0000-1234" })) await field(key).fill(value);
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "실제 API 합성 회원", exact: true }).click();
    await page.locator('[data-action="member-edit"]').click();
    await field("name").fill("실제 API 수정 회원");
    await field("height_cm").fill("180");
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    const members = await page.evaluate(async () => (await api("/members")).members);
    const saved = members.find(row => row.name === "실제 API 수정 회원");
    assert.ok(saved); assert.equal(saved.height_cm, 180);
    assert.notEqual(saved.id, saved.user_id, "Test verifies profile-id versus account-id mapping");
    assert.equal(await page.evaluate(() => localStorage.getItem("boxingcoach.dev.operations.v1")), null);
    const sessionId = await page.evaluate(async memberId => {
      const result = await api("/sessions", { method: "POST", body: JSON.stringify({ user_id: memberId, camera_config: "front", focus: "테스트", request_id: crypto.randomUUID() }) });
      await api(`/sessions/${result.session.id}/end`, { method: "PATCH", body: "{}" });
      await saveRecording({ id: result.session.id, blob: new Blob(["synthetic test recording"], { type: "video/mp4" }), mimeType: "video/mp4" });
      state.localRecordings = await loadLocalRecordings();
      return result.session.id;
    }, saved.user_id);
    await page.locator('[data-view="workouts"]').click();
    await page.locator(`[data-action="recording-play"][data-id="${sessionId}"]`).waitFor();
    const downloadEvent = page.waitForEvent("download");
    await page.locator(`[data-action="recording-download"][data-id="${sessionId}"]`).click();
    assert.equal((await downloadEvent).suggestedFilename(), `${sessionId}.mp4`);
    const popupEvent = page.waitForEvent("popup");
    await page.locator(`[data-action="recording-play"][data-id="${sessionId}"]`).click();
    const popup = await popupEvent;
    await popup.locator("video").waitFor();
    await popup.close();
    await page.locator(`[data-action="workout-delete"][data-id="${sessionId}"]`).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(async id => (await api("/sessions")).sessions.some(row => row.id === id), sessionId), true);
    await page.locator(`[data-action="workout-delete"][data-id="${sessionId}"]`).click();
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(async id => (await api("/sessions")).sessions.some(row => row.id === id), sessionId), false);
    assert.equal(await page.evaluate(async id => Boolean((await loadLocalRecordings())[id]), sessionId), false);
    await page.locator('[data-view="settings"]').click();
    await page.locator("#editAccountInfo").click();
    await field("name").fill("합성 관리자 수정");
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => state.profile.name), "합성 관리자 수정");
    const writes = [];
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    await page.locator('[data-view="dashboard"]').click();
    await page.locator('[data-action="product-new"]').click();
    await field("name").fill("실제 연결 상품");
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.getByText("실제 연결 상품", { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.ok(writes[0].endsWith("/api/operations"));
    assert.ok(await page.evaluate(async () => (await api("/operations")).products.some(row => row.name === "실제 연결 상품")));
    await page.locator('[data-view="center"]').click();
    assert.equal(await page.getByText("예상 월 매출", { exact: true }).count(), 0);
    await page.locator('[data-view="staff"]').click();
    await page.getByText("직원 업무 정보 서비스 연결 준비 중입니다.", { exact: true }).waitFor();
    fs.mkdirSync("artifacts/frontend-live", { recursive: true });
    for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ["dark", "light"]) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        for (const view of ["dashboard", "members", "attendance", "payments", "workouts", "center", "staff", "settings"]) {
          await page.locator(`[data-view="${view}"]`).click();
          await page.locator("#viewContent").waitFor();
          await page.locator('#viewContent [aria-busy="true"]').waitFor({ state: "detached" });
          await page.screenshot({ path: `artifacts/frontend-live/${view}-${width}-${theme}.png`, fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} ${width} ${theme}: page overflow`);
        }
      }
    }
    await page.evaluate(() => {
      state.user.role = "CENTER_OWNER";
      state.activeView = "accounts";
      window.accountTestWrites = 0;
      const original = api;
      api = async (route, options = {}) => {
        if (route === "/admin/accounts") {
          if (options.method === "POST") { window.accountTestWrites++; return {}; }
          throw new Error("계정 목록 조회 실패 테스트");
        }
        return original(route, options);
      };
      renderApp();
    });
    await page.locator("#toggleAccountCreate").click();
    for (const [name, value] of Object.entries({ username: "syntheticaccount", name: "합성 계정", password: "TestOnly!123", password_confirm: "TestOnly!123" })) await page.locator(`#accountCreateForm [name="${name}"]`).fill(value);
    await page.locator("#accountCreateForm button").click();
    await page.getByText("계정은 생성됐지만 목록 조회에 실패했습니다.", { exact: false }).waitFor();
    assert.equal(await page.locator("#accountCreateForm").count(), 0);
    await page.locator("#accountFilters button").click();
    await page.getByText("계정 목록 조회 실패 테스트", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => accountTestWrites), 1);
    assert.deepEqual(errors, []);
    console.log("Live operations: real member creation/edit, product persistence and profile ID mapping preserved; preview storage untouched; no fabricated center revenue/staff.");
  } finally { await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
