const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {stopTestServer}=require('../tests/browser_fixture');

async function main() {
  const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,values)=>index%2?pairs:[...pairs,[value,values[index+1]]],[]));
  if(args['--allow-paid']!=='true' || !args['--settings'] || !args['--output']) throw new Error('Requires --settings path --output new-directory --allow-paid true after budget approval');
  const output=path.resolve(args['--output']);
  if(fs.existsSync(output)) throw new Error('Choose a new output directory; uncertain paid attempts are never automatically resumed');
  const settings=Object.fromEntries(fs.readFileSync(args['--settings'],'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#')&&line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1).trim()]));
  const reference=new URL(settings.BOXING_COACH_SUPABASE_URL).hostname.split('.')[0];
  const state=JSON.parse(fs.readFileSync('artifacts/staging-smoke-accounts.json','utf8'));
  const projectResponse=await fetch(`https://api.supabase.com/v1/projects/${reference}`,{headers:{Authorization:`Bearer ${settings.SUPABASE_ACCESS_TOKEN}`}});
  assert.equal(projectResponse.status,200);
  const project=await projectResponse.json();
  assert.equal(project.name,'boxingcoach-staging');
  assert.equal(project.status,'ACTIVE_HEALTHY');
  assert.equal(state.project,reference);
  assert.ok(state.accounts.member.username.startsWith('stg_'));
  fs.mkdirSync(output,{recursive:true});
  const record=value=>fs.appendFileSync(path.join(output,'evidence.jsonl'),JSON.stringify(value)+'\n');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'boxing-central-coach-'));
  const server=spawn(process.env.BOXING_COACH_PYTHON||'python',['-B','-u','backend/server.py'],{windowsHide:true,env:{...process.env,
    BOXING_COACH_DATA_MODE:'supabase',BOXING_COACH_SUPABASE_URL:settings.BOXING_COACH_SUPABASE_URL,
    BOXING_COACH_SUPABASE_PUBLISHABLE_KEY:settings.BOXING_COACH_SUPABASE_PUBLISHABLE_KEY,
    BOXING_COACH_AUTH_EMAIL_DOMAIN:settings.BOXING_COACH_AUTH_EMAIL_DOMAIN,
    BOXING_COACH_DB_PATH:path.join(temporary,'unused.db'),BOXING_COACH_HOST:'127.0.0.1',BOXING_COACH_PORT:'0',BOXING_COACH_OPEN_BROWSER:'0'}});
  let browser;
  try {
    const origin=await new Promise((resolve,reject)=>{
      let output='';
      const timeout=setTimeout(()=>reject(new Error('Gateway readiness timeout')),15000);
      server.once('error',error=>{clearTimeout(timeout);reject(error);});
      server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Gateway exited ${code}`));});
      server.stderr.on('data',()=>{});
      server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/BOXING_COACH_READY (.*)\r?\n/);if(match){const ready=JSON.parse(match[1]);server.workerPid=ready.pid;clearTimeout(timeout);resolve(ready.url);}});
    });
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1366,height:960},serviceWorkers:'block'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);
    await page.locator('[name="username"]').fill(state.accounts.member.username);
    await page.locator('[name="password"]').fill(state.accounts.member.password);
    await page.locator('#authSubmit').click();
    await page.locator('#sidebar').waitFor({state:'visible',timeout:30000});
    const before=await page.evaluate(()=>api('/coach/usage'));
    const totals={input_tokens:0,output_tokens:0,total_tokens:0};
    for(const [language,model,question] of [['ko','gpt-4.1-mini','저장된 운동 관측과 측정되지 않은 점을 짧게 설명해 주세요.'],['en','gpt-5-mini','Briefly explain the saved observations and what was not measured.']]) {
      await page.reload();
      await page.locator('#sidebar').waitFor({state:'visible',timeout:30000});
      await page.locator('[data-view="settings"]').click();
      await page.locator('#languageSetting').selectOption(language);
      await page.locator('[data-view="coach"]').click();
      await page.evaluate(async()=>{
        const result=await api('/sessions');
        const session=result.sessions.find(session=>session.ended_at);
        if(!session) throw new Error('No completed synthetic member round');
        RoundCoach.clear();
        RoundCoach.show(session);
      });
      await page.waitForFunction(()=>!document.querySelector('#coachQuestion').disabled);
      const selector=page.locator('.coach-model-controls select');
      await selector.selectOption(model);
      await page.locator('#coachQuestion').fill(question);
      record({stage:'before_send',language,model});
      const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/coach/reply'),{timeout:30000});
      await page.locator('.coach-input [type="submit"]').click();
      const response=await responsePromise;
      const result=await response.json();
      record({stage:'reply',language,model,status:response.status(),result});
      assert.equal(response.status(),200);
      assert.equal(result.usage_recorded,true);
      assert.equal(result.model,model);
      if(language==='en') assert.doesNotMatch(result.text,/[가-힣]/);
      await page.getByText(result.text,{exact:true}).waitFor();
      for(const key of Object.keys(totals)){assert.ok(Number.isSafeInteger(result.usage[key]));totals[key]+=result.usage[key];}
      await page.waitForFunction(()=>!document.querySelector('.coach-input [type="submit"]').disabled);
      assert.equal(await selector.inputValue(),model);
      assert.equal(await page.locator('.coach-usage-warning').textContent(),'');
      const after=await page.evaluate(()=>api('/coach/usage'));
      assert.equal(await page.locator('.coach-usage').textContent(),await page.evaluate(usage=>CoachApi.formatUsage(usage),after));
      await page.screenshot({path:path.join(output,`reply-${language}.png`),fullPage:true});
      await page.locator('[data-coach-close]').click();
      await page.locator('[data-round-finish]').click();
    }
    const after=await page.evaluate(()=>api('/coach/usage'));
    for(const key of Object.keys(totals)) assert.equal(after[key],(before[key]||0)+totals[key]);
    assert.equal(after.requests,before.requests+2);
    assert.deepEqual(errors,[]);
    record({stage:'verified',totals,usage_delta:2,scope:after.scope});
    console.log(JSON.stringify({verified:true,totals,usage_delta:2,scope:after.scope}));
  } finally {await browser?.close();await stopTestServer(server);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
