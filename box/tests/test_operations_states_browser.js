const assert = require("node:assert/strict");
const { browserFixture } = require("./browser_fixture");

(async () => {
  const fixture = await browserFixture();
  const { page, url } = fixture;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${url}/preview.html?enable=1`);
    await page.locator('[data-action="dashboard-visits"]').waitFor();
    await page.evaluate(async () => {
      window.testData = await BoxingOperations.create({ enabled: true, storage: localStorage }).snapshot();
      window.testData.operationsConnected = true;
      window.testInitial = structuredClone(window.testData);
      window.mountTest = (view, role = "CENTER_OWNER", mode = "normal") => {
        const oldHost = document.querySelector("#operationsRoot");
        const host = document.createElement("div");
        host.id = "operationsRoot";
        oldHost.replaceWith(host);
        window.writeCount = 0;
        window.readCount = 0;
        const adapter = {
          snapshot: async () => {
            window.readCount++;
            if (mode === "load-fail" || (mode === "save-refresh-fail" && window.writeCount)) throw new Error("조회 실패 테스트");
            if (mode === "loading") await new Promise(resolve => { window.releaseRead = resolve; });
            return structuredClone(window.testData);
          },
          saveMember: async () => {
            window.writeCount++;
            if (mode === "save-delay") await new Promise(resolve => { window.releaseWrite = resolve; });
          },
        };
        if (["center", "staff", "profile"].includes(view)) {
          const original = BoxingOperations;
          try {
            window.BoxingOperations = { create: () => adapter };
            window.testMount = mountOperations({ host, initialView: view });
          } finally { window.BoxingOperations = original; }
        } else window.testMount = mountOperations({ host, initialView: view, user: { id: "preview-owner", role }, adapter });
      };
    });
    for (const view of ["dashboard", "members", "attendance", "payments", "workouts", "home", "center", "staff", "profile"]) {
      const role = view === "home" ? "MEMBER" : "CENTER_OWNER";
      await page.evaluate(({ view, role }) => mountTest(view, role, "load-fail"), { view, role });
      await page.getByRole("alert").filter({ hasText: "조회 실패 테스트" }).waitFor();
      await page.getByRole("button", { name: "다시 시도", exact: true }).click();
      assert.equal(await page.evaluate(() => readCount), 2);
      await page.evaluate(({ view, role }) => mountTest(view, role, "loading"), { view, role });
      await page.locator('[aria-busy="true"]').waitFor();
      await page.evaluate(() => releaseRead());
      await page.locator('[aria-busy="true"]').waitFor({ state: "detached" });
    }
    await page.evaluate(() => mountTest("members", "MEMBER"));
    await page.getByText("이 화면에 접근할 권한이 없습니다.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => readCount), 0);
    await page.evaluate(() => mountTest("members", "PLATFORM_ADMIN"));
    await page.locator('[data-action="member"]').first().waitFor();
    assert.equal(await page.locator('[data-action="member-new"]').count(), 0);
    await page.evaluate(() => mountTest("members", "CENTER_OWNER", "save-refresh-fail"));
    await page.locator('[data-action="member-edit"]').count();
    await page.locator('[data-action="member"]').first().click();
    await page.locator('[data-action="member-edit"]').click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("dialog"))), true);
    await page.locator('dialog [type="submit"]').click();
    await page.locator("dialog").waitFor({ state: "detached" });
    await page.getByRole("alert").filter({ hasText: "저장은 완료됐지만 목록을 불러오지 못했습니다" }).waitFor();
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    assert.equal(await page.evaluate(() => writeCount), 1);
    await page.evaluate(() => mountTest("members", "CENTER_OWNER", "save-delay"));
    await page.locator('[data-action="member"]').first().click();
    await page.locator('[data-action="member-edit"]').click();
    await page.locator('dialog [type="submit"]').click();
    assert.equal(await page.locator('dialog [type="submit"]').isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.evaluate(() => { document.querySelector("dialog form").requestSubmit(); releaseWrite(); });
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => writeCount), 1);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "member-edit");
    await page.evaluate(() => {
      testData.members = Array.from({ length: 57 }, (_, index) => ({ ...testData.members[0], id: `preview-long-${index}`, name: `긴 이름 ${index} <img src=x onerror=alert(1)> ${"합성".repeat(80)}` }));
      mountTest("members");
    });
    await page.getByText("총 57건 · 1 / 6페이지", { exact: true }).waitFor();
    assert.equal(await page.locator(".op-table-scroll img").count(), 0);
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page.getByText("총 57건 · 2 / 6페이지", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('[data-filter] [name="search"]').fill("없는 검색값");
    await page.locator('[data-filter] [type="submit"]').click();
    await page.getByText("검색 결과가 없습니다.", { exact: true }).waitFor();
    await page.evaluate(() => {
      testData = structuredClone(testInitial);
      testData.members[0].name = "긴 합성 회원 ".repeat(12);
      for (const key of ["passes", "payments", "workouts", "attendance", "staff"]) {
        testData[key] = Array.from({ length: 47 }, (_, index) => ({ ...testInitial[key][0], id: `preview-${key}-${index}` }));
      }
      testData.members = Array.from({ length: 47 }, (_, index) => ({ ...testInitial.members[0], id: `preview-roster-${index}` }));
      testData.passes.forEach(row => row.member_id = testData.members[0].id);
    });
    for (const view of ["members", "payments", "workouts", "attendance", "staff"]) {
      await page.evaluate(view => mountTest(view), view);
      if (view === "members") {
        await page.locator('[data-action="member"]').first().click();
        await page.locator('[data-action="member-tab"][data-id="passes"]').click();
      }
      await page.getByText("총 47건 · 1 / 5페이지", { exact: true }).waitFor();
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("총 47건 · 2 / 5페이지", { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} long mobile table`);
      await page.locator('[data-filter] [name="search"]').fill("없는 검색값");
      await page.locator('[data-filter] [type="submit"]').click();
      await page.getByText("검색 결과가 없습니다.", { exact: true }).waitFor();
    }
    await page.evaluate(() => { for (const key of ["members", "products", "passes", "attendance", "payments", "notes", "workouts", "staff"]) testData[key] = []; });
    for (const view of ["members", "dashboard", "attendance", "payments", "workouts", "staff"]) {
      await page.evaluate(view => mountTest(view), view);
      await page.locator(".op-empty").first().waitFor();
    }
    assert.deepEqual(errors, []);
    console.log("Operations states: load/error/retry, empty and long lists, access denial, save followed by refresh failure, duplicate suppression and focus restoration passed.");
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
