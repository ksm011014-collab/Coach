const assert=require('node:assert/strict');
const {browserFixture}=require('./browser_fixture');
(async()=>{
  const fixture=await browserFixture();
  const {page}=fixture;
  try {
    await fixture.login();
    await page.locator('[data-view="settings"]').click();
    await page.locator('#languageSetting').selectOption('en');
    await page.locator('[data-view="coach"]').click();
    await page.route('**/api/coach/models',route=>route.fulfill({json:{available:true,default_model:'test-a',models:[{model_id:'test-a',display_name:'Test A'},{model_id:'test-b',display_name:'Test B'}]}}));
    await page.route('**/api/coach/usage',route=>route.fulfill({json:{scope:'self',period_start:'2026-09-01T00:00:00Z',period_end:'2026-09-23T00:00:00Z',input_tokens:null,output_tokens:null,unmeasured_requests:1}}));
    const requests=[];
    await page.route('**/api/coach/reply',route=>{
      requests.push(route.request().postDataJSON());
      return route.fulfill({status:requests.length===1?503:409,json:{error:requests.length===1?'coach_unavailable':'coach_duplicate'}});
    });
    await page.evaluate(()=>RoundCoach.show({id:'test-session',started_at:100,ended_at:110}));
    await page.waitForFunction(()=>!document.querySelector('#coachQuestion').disabled);
    assert.equal(await page.getByLabel('AI model',{exact:true}).inputValue(),'test-a');
    assert.match(await page.locator('.coach-usage').textContent(),/You.*UTC.*Not measured/);
    await page.getByLabel('AI model',{exact:true}).selectOption('test-b');
    await page.locator('#coachQuestion').fill('How was my workout?');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText('The AI service is not configured. Contact your administrator.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText('This request was already accepted. It was not sent again to prevent duplicate charges.',{exact:true}).waitFor();
    assert.equal(requests.length,2);
    assert.equal(requests[0].request_id,requests[1].request_id);
    assert.equal(requests[0].model,'test-b');
    assert.equal(requests[0].language,'en');
    assert.equal(requests[0].summary,undefined,'client never supplies authoritative measurements');
    await page.unroute('**/api/coach/reply');
    await page.route('**/api/coach/reply',route=>route.fulfill({json:{text:'Synthetic provider answer',usage:{input_tokens:10,output_tokens:5,total_tokens:15},usage_recorded:false}}));
    await page.locator('#coachQuestion').fill('Give me a different drill.');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText('Synthetic provider answer',{exact:true}).waitFor();
    assert.match(await page.locator('.coach-usage-warning').textContent(),/usage storage could not be confirmed/);
    await page.locator('[data-coach-close]').click();
    await page.locator('[data-round-finish]').click();
    console.log('Coach browser: server models, language, usage unknown, dedup retry and persistence warning passed (mock API).');
  } finally {await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
