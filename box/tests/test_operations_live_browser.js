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
    const writes = [];
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    await page.locator('[data-view="memberships"]').click();
    await page.locator('[data-action="product-new"]').click();
    await field("name").fill("차단돼야 하는 상품");
    await page.locator('dialog [type="submit"]').click();
    await page.locator('dialog [role="alert"]').filter({ hasText: "백엔드 연결 준비 중" }).waitFor();
    assert.equal(await field("name").inputValue(), "차단돼야 하는 상품");
    assert.deepEqual(writes, []);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.locator('[data-view="center"]').click();
    assert.equal(await page.getByText("예상 월 매출", { exact: true }).count(), 0);
    await page.locator('[data-view="staff"]').click();
    await page.getByText("직원 업무 정보 서비스 연결 준비 중입니다.", { exact: true }).waitFor();
    fs.mkdirSync("artifacts/frontend-live", { recursive: true });
    for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ["dark", "light"]) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        for (const view of ["dashboard", "members", "memberships", "attendance", "payments", "workouts", "center", "staff", "settings"]) {
          await page.locator(`[data-view="${view}"]`).click();
          await page.locator("#viewContent").waitFor();
          await page.locator('#viewContent [aria-busy="true"]').waitFor({ state: "detached" });
          await page.screenshot({ path: `artifacts/frontend-live/${view}-${width}-${theme}.png`, fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} ${width} ${theme}: page overflow`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("Live operations: real member creation/edit and profile ID mapping preserved; unconnected writes blocked before HTTP; preview storage untouched; no fabricated center revenue/staff.");
  } finally { await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
