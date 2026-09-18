const assert = require("node:assert/strict");
const fs = require("node:fs");
const { browserFixture } = require("./browser_fixture");

(async () => {
  const fixture = await browserFixture();
  const { page, url } = fixture;
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
  const click = (action, id) => page.locator(`[data-action="${action}"]${id === undefined ? "" : `[data-id="${id}"]`}`).first().click();
  const field = name => page.locator(`dialog [name="${name}"]`);
  const save = async () => { await page.locator('dialog [type="submit"]').click(); await page.locator("dialog").waitFor({ state: "detached" }); };
  try {
    await page.goto(`${url}/preview.html`);
    await page.getByText("미리보기는 꺼져 있습니다.", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("boxingcoach.dev.operations.v1")), null);
    await page.evaluate(() => { localStorage.setItem("boxing_auth", "isolation-sentinel"); localStorage.setItem("boxing_staff", "staff-sentinel"); });
    await page.goto(`${url}/preview.html?enable=1`);
    await page.getByRole("heading", { name: "운영 대시보드", exact: true }).waitFor();
    await click("navigate", "members");
    await click("member-new");
    await field("name").fill("테스트 <회원> & 이름");
    await field("phone").fill("010-0000-9999");
    await save();
    await page.getByRole("button", { name: "테스트 <회원> & 이름", exact: true }).click();
    await click("member-edit");
    await field("name").fill("수정한 테스트 회원");
    await save();
    await page.getByRole("heading", { name: "수정한 테스트 회원", exact: true }).first().waitFor();
    await click("member-tab", "notes");
    await click("note-new");
    await field("content").fill("상담 메모 <script>안전한 텍스트</script>");
    await save();
    await page.getByText("상담 메모 <script>안전한 텍스트</script>", { exact: true }).waitFor();
    await click("member-tab", "passes");
    await click("pass-new");
    await field("end_on").fill("2026-10-18");
    await field("reason").fill("신규 등록");
    await save();
    await click("pass-detail");
    await field("action").selectOption("PAUSE");
    await field("reason").fill("여행 휴회");
    await save();
    await page.locator('#opMain [data-tone="PAUSED"]').waitFor();
    await click("navigate", "attendance");
    await click("visit-new");
    await field("member_id").selectOption({ label: "수정한 테스트 회원" });
    await field("reason").fill("수동 방문");
    await save();
    await page.getByText("수동 방문", { exact: true }).waitFor();
    await click("navigate", "payments");
    await click("payment-new");
    await field("member_id").selectOption({ label: "수정한 테스트 회원" });
    await field("amount").fill("150000");
    await save();
    const paidRow = page.locator("tr").filter({ hasText: "수정한 테스트 회원" });
    await paidRow.locator('[data-action="payment-detail"]').click();
    await field("action").selectOption("REFUND");
    await field("amount").fill("10000");
    await field("reason").fill("환불 사실 기록");
    await save();
    await paidRow.getByText("부분 환불 기록", { exact: true }).waitFor();
    // Save failure retains values and never emits success; retry does not duplicate.
    await click("navigate", "members");
    await click("fail-next");
    await click("member-new");
    await field("name").fill("실패 후 재시도 회원");
    await field("phone").fill("010-0000-8888");
    await page.locator('dialog [type="submit"]').click();
    await page.locator('dialog [role="alert"]').filter({ hasText: "개발용 장애 재현" }).waitFor();
    assert.equal(await field("name").inputValue(), "실패 후 재시도 회원");
    assert.equal(await page.locator(".op-status").textContent(), "다음 조회 또는 저장 요청을 실패시킵니다.");
    await page.locator('dialog [type="submit"]').dblclick();
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "실패 후 재시도 회원", exact: true }).count(), 1);
    await page.locator('[data-filter] [name="search"]').fill("없는 이름");
    await page.locator('[data-filter] [type="submit"]').click();
    await page.getByText("검색 결과가 없습니다.", { exact: true }).waitFor();
    await click("clear-filter");
    await click("fail-next");
    await page.locator("#previewDate").fill("2026-09-19");
    await page.locator("#previewDate").blur();
    await page.getByRole("button", { name: "다시 시도", exact: true }).waitFor();
    await click("retry");
    await page.getByRole("button", { name: "회원 등록", exact: true }).waitFor();
    fs.mkdirSync("artifacts/frontend-progress", { recursive: true });
    for (const role of ["CENTER_OWNER", "COACH", "MEMBER"]) {
      await page.locator("#previewRole").selectOption(role);
      await page.locator("#opMain h1").waitFor();
      for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
        await page.setViewportSize({ width, height });
        for (const theme of ["dark", "light"]) {
          await page.evaluate(theme => { document.body.dataset.theme = theme; }, theme);
          await page.screenshot({ path: `artifacts/frontend-progress/${role}-${width}-${theme}.png`, fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role} ${width} ${theme} page overflow`);
        }
      }
    }
    assert.equal(await page.evaluate(() => localStorage.getItem("boxing_auth")), "isolation-sentinel");
    assert.equal(await page.evaluate(() => localStorage.getItem("boxing_staff")), "staff-sentinel");
    assert.deepEqual(requests, [], "Preview must make no API calls, including reads");
    assert.deepEqual(errors, []);
    console.log("Preview browser flows passed: member editing, notes, pass pause, visit, payment/refund, failure preservation/retry, no API calls, storage isolation, 3 roles × 3 viewports × 2 themes without page overflow.");
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
