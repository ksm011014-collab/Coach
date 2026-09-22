const assert = require("node:assert/strict");
const fs = require("node:fs");
const { browserFixture } = require("./browser_fixture");

(async () => {
  const fixture = await browserFixture();
  const { page } = fixture;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await fixture.login();
    await page.locator('[data-view="settings"]').click();
    await page.locator("#languageSetting").selectOption("en");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("#viewTitle").textContent(), "Settings");
    assert.equal(await page.locator('[data-view="members"] .nav-label').textContent(), "Members");
    assert.equal(await page.locator("#saveAllSettings").textContent(), "Save settings");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("boxing_settings")).language), "en");
    assert.match(await page.locator("#userName").textContent(), /합성 테스트 관리자/);
    await page.locator('[data-view="members"]').click();
    await page.getByRole("button", { name: "Register member", exact: true }).click();
    const memberFields = { username: "languagemember", email: "language@example.invalid", password: "TestOnly!123", password_confirm: "TestOnly!123", name: "회원", phone: "010-0000-0000" };
    for (const [name, value] of Object.entries(memberFields)) await page.locator(`dialog [name="${name}"]`).fill(value);
    assert.equal(await page.locator('dialog [name="gender"] option[value="male"]').textContent(), "Male");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "회원", exact: true }).click();
    assert.equal(await page.locator("#member-panel h2").textContent(), "회원");
    await page.locator('[data-view="attendance"]').click();
    await page.locator(".op-calendar").waitFor();
    assert.equal(await page.locator('.op-calendar > span[data-weekday="0"]').textContent(), "Sun");
    await page.locator('[data-view="workouts"]').click();
    await page.getByText("No workouts saved. Visit attendance is shown separately.").waitFor();
    await page.locator('[data-view="center"]').click();
    await page.getByRole("button", { name: "Save center details", exact: true }).waitFor();
    await page.locator('#centerShared [name="address"]').fill("센터 정보");
    await page.getByRole("button", { name: "Save center details", exact: true }).click();
    await page.locator(".op-center-message").filter({ hasText: "Saved." }).waitFor();
    assert.equal(await page.locator('#centerShared [name="address"]').inputValue(), "센터 정보");
    await page.evaluate(() => {
      window.languageTestUser = state.user;
      state.user = { ...state.user, role: "CENTER_OWNER" };
      state.activeView = "accounts";
      renderApp();
    });
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByRole("button", { name: "Create account", exact: true }).waitFor();
    assert.equal(await page.locator('#accountCreateForm [name="role"] option[value="COACH"]').textContent(), "Coach");
    await page.evaluate(() => {
      state.user = { ...state.user, role: "PLATFORM_ADMIN" };
      state.platformCenters = [{ id: "language-center", name: "센터", code: "sample", status: "ACTIVE", plan_code: "starter", subscription_status: "TRIAL", starts_at: "2026-09-01" }];
      renderPlatformOperations();
    });
    assert.equal(await page.locator('#platformCenterForm [name="name"]').inputValue(), "센터");
    assert.equal(await page.locator('#platformCenterForm [name="status"] option[value="SUSPENDED"]').textContent(), "Suspended");
    await page.getByText("Preview new web interface", { exact: true }).waitFor();
    await page.evaluate(() => {
      state.user = window.languageTestUser;
      delete window.languageTestUser;
      state.platformCenters = [];
      state.selectedPlatformCenterId = "";
    });
    await page.locator('[data-view="settings"]').click();
    fs.mkdirSync("artifacts/language", { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.locator(`[data-setting-theme="${theme}"]`).click();
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `artifacts/language/settings-en-${theme}-${width}.png`, fullPage: true });
      }
    }
    await page.reload();
    await page.locator("#sidebar").waitFor({ state: "visible" });
    await page.locator('[data-view="settings"]').click();
    assert.equal(await page.locator("#languageSetting").inputValue(), "en");
    await page.locator("#languageSetting").selectOption("ko");
    assert.equal(await page.locator("#viewTitle").textContent(), "설정");
    assert.equal(await page.locator("#saveAllSettings").textContent(), "설정 저장");
    await page.locator("#languageSetting").selectOption("en");
    await page.locator("#logoutButton").click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    assert.equal(await page.locator('#loginForm [name="username"]').getAttribute("placeholder"), "Enter your username");
    await page.getByRole("button", { name: "Register a center or member", exact: true }).click();
    assert.equal(await page.locator('#loginForm [name="signup_role"] option[value="MEMBER"]').textContent(), "Member: join with a center code");
    assert.deepEqual(errors, []);
    console.log("Language persistence, navigation, settings, preserved user data and responsive themes passed.");
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
