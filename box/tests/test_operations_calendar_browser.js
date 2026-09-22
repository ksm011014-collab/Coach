const assert = require('node:assert/strict');
const { browserFixture } = require('./browser_fixture');

(async () => {
  const fixture = await browserFixture();
  const { page, url } = fixture;
  try {
    await page.goto(`${url}/preview.html?enable=1`);
    await page.locator('[data-action="dashboard-visits"]').waitFor();
    await page.evaluate(async () => {
      window.calendarData = await BoxingOperations.create({ enabled: true, storage: localStorage }).snapshot();
      calendarData.operationsConnected = true;
      calendarData.referenceDate = '2026-12-31';
      window.mountCalendar = () => {
        const host = document.createElement('div');
        host.id = 'operationsRoot';
        document.querySelector('#operationsRoot').replaceWith(host);
        window.calendarController = mountOperations({ host, initialView: 'attendance', user: { id: 'preview-owner', role: 'CENTER_OWNER' }, adapter: { snapshot: async () => structuredClone(calendarData) } });
      };
      mountCalendar();
    });
    const selected = date => page.locator(`.op-calendar button[data-id="${date}"][aria-pressed="true"]`);
    await selected('2026-12-31').waitFor();
    await page.evaluate(async () => { calendarData.referenceDate = '2027-01-01'; await calendarController.refresh(); });
    await selected('2027-01-01').waitFor();
    await page.locator('[data-action="month"][data-id="-1"]').click();
    await selected('2026-12-01').waitFor();
    await page.locator('.op-calendar [data-id="2026-12-15"]').click();
    await selected('2026-12-15').waitFor();
    await page.evaluate(async () => { calendarData.referenceDate = '2027-02-01'; await calendarController.refresh(); });
    await selected('2026-12-15').waitFor();
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await selected('2027-02-01').waitFor();
    await page.evaluate(async () => { calendarData.referenceDate = '2027-03-01'; await calendarController.refresh(); });
    await selected('2027-03-01').waitFor();
    await page.evaluate(() => { calendarData.referenceDate = '2028-01-01'; mountCalendar(); });
    await selected('2028-01-01').waitFor();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.body.dataset.theme = value, theme);
      const colors = await page.evaluate(() => [0, 1, 6].map(day => getComputedStyle(document.querySelector(`.op-calendar span[data-weekday="${day}"]`)).color));
      assert.notEqual(colors[0], colors[1]);
      assert.notEqual(colors[6], colors[1]);
      assert.notEqual(colors[0], colors[6]);
    }
    assert.equal(await page.getByRole('button', { name: '수동 출석', exact: true }).count(), 0);
    console.log('Calendar: today, month/year rollover, retained historical selection, reentry and weekend colors passed');
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
