const assert = require("node:assert/strict");
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
  const failThenSave = async () => {
    const before = await page.locator("dialog form").evaluate(form => [...new FormData(form)]);
    await page.locator('dialog [type="submit"]').click();
    await page.locator('dialog [role="alert"]').filter({ hasText: "개발용 장애 재현" }).waitFor();
    assert.deepEqual(await page.locator("dialog form").evaluate(form => [...new FormData(form)]), before);
    await save();
  };
  try {
    await page.goto(`${url}/preview.html?enable=1`);
    await page.locator('[data-action="dashboard-visits"]').waitFor();
    await click("dashboard-visits");
    await page.getByRole("heading", { name: "2026-09-18 출결", exact: true }).waitFor();
    await click("month", "-1");
    await page.getByRole("heading", { name: "2026-08", exact: true }).waitFor();
    await click("visit-date", "2026-08-10");
    await page.locator('tr [data-action="member"][data-id="preview-member-1"]').waitFor();
    await click("navigate", "dashboard");
    assert.equal(await page.locator(".op-chart-column").count(), 6);
    assert.equal(await page.locator('[data-action="dashboard-expiring"]').count(), 0);
    await click("fail-next");
    await click("product-new");
    await field("name").fill("합성 체험권");
    await field("kind").selectOption("TRIAL");
    await field("count").fill("1");
    await field("price").fill("3000");
    await failThenSave();
    await page.locator("tr").filter({ hasText: "합성 체험권" }).locator('[data-action="product-edit"]').click();
    await field("price").fill("4000");
    await save();
    await page.locator("tr").filter({ hasText: "합성 체험권" }).getByText("4,000원", { exact: true }).waitFor();
    await click("navigate", "members");
    await click("member", "preview-member-3");
    await click("member-tab", "passes");
    await click("fail-next");
    await click("pass-new");
    await field("member_id").selectOption("preview-member-3");
    await field("start_on").fill("2026-10-01");
    await field("end_on").fill("2026-10-31");
    await field("reason").fill("시작 전 이용권 확인");
    await failThenSave();
    await click("navigate", "members");
    const futureMember = page.locator("tr").filter({ hasText: "샘플 박세나" });
    await futureMember.waitFor();
    assert.equal(await futureMember.getByText("시작 전", { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-filter] [name="status"] option[value="UPCOMING"]').count(), 0);
    assert.equal(await page.locator('tr [data-action="member"]').count(), 3);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('boxingcoach.dev.operations.v1')).passes.some(pass => pass.member_id === 'preview-member-3' && pass.start_on === '2026-10-01' && pass.status === 'ACTIVE')));
    await click("member", "preview-member-3");
    await click("member-tab", "notes");
    await click("fail-next");
    await click("note-new");
    await field("content").fill("합성 상담 메모");
    await failThenSave();
    await page.getByText("합성 상담 메모", { exact: true }).waitFor();
    await click("navigate", "members");
    await click("member", "preview-member-1");
    await click("member-tab", "passes");
    for (const [action, reason] of [["PAUSE", "휴회 감사"], ["RESUME", "재개 감사"], ["EXTEND", "연장 감사"], ["CANCEL", "해지 감사"]]) {
      await click("pass-detail", "preview-pass-1");
      await field("action").selectOption(action);
      await field("reason").fill(reason);
      if (action === "EXTEND") await field("end_on").fill("2026-11-30");
      await save();
    }
    await click("pass-detail", "preview-pass-1");
    for (const reason of ["휴회 감사", "재개 감사", "연장 감사", "해지 감사"]) await page.locator("dialog").getByText(reason, { exact: true }).waitFor();
    assert.equal(await page.locator('dialog [type="submit"]').count(), 0);
    await page.keyboard.press("Escape");
    await click("navigate", "attendance");
    await click("fail-next");
    await click("visit-new");
    await field("member_id").selectOption("preview-member-3");
    await field("reason").fill("출석 감사");
    await failThenSave();
    await page.locator("tr").filter({ hasText: "출석 감사" }).locator('[data-action="visit-cancel"]').click();
    await field("reason").fill("출석 취소 감사");
    await save();
    await page.locator("tr").filter({ hasText: "샘플 박세나" }).getByText("결석", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("boxingcoach.dev.operations.v1")).attendance.some(row => row.reason === "출석 취소 감사" && row.status === "CANCELLED")));
    await click("navigate", "payments");
    await click("fail-next");
    await click("payment-new");
    await field("member_id").selectOption("preview-member-3");
    await field("amount").fill("2000");
    await field("status").selectOption("UNPAID");
    await failThenSave();
    await page.locator("tr").filter({ hasText: "샘플 박세나" }).locator('[data-action="payment-detail"]').click();
    await field("reason").fill("미납 취소 감사");
    await save();
    await click("payment-detail", "preview-payment-1");
    await field("action").selectOption("REFUND");
    await field("amount").fill("150000");
    await field("reason").fill("전체 환불 사실 감사");
    await save();
    await page.locator("tr").filter({ hasText: "샘플 김하나" }).getByText("환불 기록", { exact: true }).waitFor();
    await page.locator('[data-filter] [name="from"]').fill("2026-09-01");
    await page.locator('[data-filter] [name="to"]').fill("2026-09-18");
    await page.locator('[data-filter] [type="submit"]').click();
    assert.equal(await page.locator('[data-filter] [name="from"]').inputValue(), "2026-09-01");
    assert.equal(await page.locator('[data-filter] [name="to"]').inputValue(), "2026-09-18");
    for (const [view, action, values] of [
      ["center", "center-edit", { name: "실패 후 센터 저장" }],
      ["staff", "staff-new", { name: "실패 후 직원 저장", phone: "010-0000-0011", job: "코치" }],
      ["profile", "profile-edit", { name: "실패 후 본인 저장" }],
    ]) {
      await click("navigate", view);
      await click("fail-next");
      await click(action);
      for (const [name, value] of Object.entries(values)) await field(name).fill(value);
      await failThenSave();
    }
    await page.locator("#previewRole").selectOption("MEMBER");
    await click("navigate", "profile");
    await click("fail-next");
    await click("profile-edit");
    await field("name").fill("회원 본인 저장 실패 재시도");
    await failThenSave();
    await page.locator("#previewRole").selectOption("CENTER_OWNER");
    for (const view of ["dashboard", "members", "attendance", "payments", "workouts", "center", "staff", "profile"]) {
      await click("navigate", view);
      await click("fail-next");
      await page.locator("#previewDate").dispatchEvent("change");
      await page.getByRole("alert").filter({ hasText: "개발용 장애 재현" }).waitFor();
      await click("retry");
      await page.locator('[aria-busy="true"]').waitFor({ state: "detached" });
      assert.equal(await page.locator('[role="alert"]').count(), 0);
    }
    assert.deepEqual(requests, [], "No preview operation may call a real API");
    assert.deepEqual(errors, []);
    console.log("A–H audit: dashboard links, future membership, product edit, pause/resume/extend/cancel, visits, full refunds, every new write failure and view reload retry passed.");
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
