const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserFixture } = require('./browser_fixture');

(async () => {
  const fixture = await browserFixture();
  try {
    await fixture.login();
    const page = fixture.page;
    await page.locator('[data-view="settings"]').click();
    assert.equal(await page.locator('#motionFeedbackMode').inputValue(),'summary');
    await page.locator('#motionFeedbackMode').selectOption('event');
    assert.equal(await page.evaluate(()=>loadSettings().motionFeedback),'event');
    await page.locator('#motionFeedbackMode').selectOption('summary');
    await page.locator('[data-view="coach"]').click();
    fs.mkdirSync('artifacts/round-coach', { recursive: true });
    for (const language of ['ko', 'en']) {
    await page.evaluate(language => BoxingI18n.setLanguage(language), language);
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(({ theme, width, language }) => {
          delete document.body.dataset.theme;
          state.settings.theme = theme;
          state.settings.language = language;
          applyTheme();
          updateSessionControls();
          showSessionError(new Error('운동할 회원을 선택해주세요.'));
          RoundCoach.show({ id: `synthetic-${language}-${theme}-${width}`, started_at: 100, ended_at: 280,
            feedback_report:JSON.stringify({version:1,status:'experimental',counts:{jab:2,hook:1,uppercut:0,one_two:1},total_points:38,mean_quality:76,events:[{guard_ratio:1},{guard_ratio:0.2},{guard_ratio:0.3}]}) });
        }, { theme, width, language });
        const dialog = page.locator('#roundCoachDialog');
        await dialog.waitFor({ state: 'visible' });
        assert.match(await dialog.innerText(), language === 'en' ? /3 min 0 sec/ : /3분 0초/);
        assert.match(await dialog.innerText(), language === 'en' ? /Jabs 2/ : /잽 2회/);
        assert.match(await dialog.innerText(), language === 'en' ? /Total 38 points/ : /누적 38점/);
        assert.match(await dialog.innerText(), language === 'en' ? /Average performance quality 76/ : /평균 수행 품질 76/);
        await dialog.getByText(language === 'en' ? 'Repeated observation: the non-punching hand appeared lowered in 2 movements.' : '반복 관측: 2개 동작에서 반대손 가드가 내려간 것으로 감지됐습니다.',{exact:true}).waitFor();
        assert.equal(await page.locator('#sessionState').textContent(), language === 'en' ? 'Ready' : '대기 중');
        assert.equal(await page.locator('#sessionMessage').textContent(), language === 'en' ? 'Select a member to start training.' : '운동할 회원을 선택해주세요.');
        if (language === 'en') assert.doesNotMatch(await dialog.innerText(), /[가-힣]/);
        assert.equal(await page.locator('#coachQuestion').isDisabled(), true);
        assert.equal(await dialog.evaluate(element=>getComputedStyle(element).backgroundColor),theme==='light'?'rgb(244, 248, 250)':'rgb(7, 28, 39)');
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
        await page.screenshot({ path: `artifacts/round-coach/popup-${language}-${width}-${theme}.png`, fullPage: true });
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true);
        await page.locator('[data-coach-close]').click();
        assert.equal(await page.locator('#roundNextActions').count(), 1);
        await page.locator('[data-round-finish]').click();
        assert.equal(await page.evaluate(() => RoundCoach.isBlocking()), false);
      }
    }
    }
    await page.evaluate(() => BoxingI18n.setLanguage('ko'));
    await page.evaluate(() => {
      RoundCoach.configureService({reply:async request=>{
        window.coachTestRequest={summary:request.summary,question:request.question};
        return {text:'<img src=x onerror=alert(1)> 합성 응답'};
      },voice:{
        stop:()=>{window.voiceTestStops=(window.voiceTestStops||0)+1;},
        listen:async request=>{request.onStart();return {text:'합성 음성 질문'};},
        speak:request=>{window.voiceTestRequest=request;request.onStart();request.onLevel(0.6);return new Promise(()=>{});},
      }});
      RoundCoach.show({id:'synthetic-chat',user_id:'private',started_at:0,ended_at:10});
    });
    await page.waitForFunction(()=>!document.querySelector('#coachQuestion').disabled);
    await page.locator('[data-coach-microphone]').click();
    await page.waitForFunction(()=>document.querySelector('#coachQuestion').value==='합성 음성 질문');
    await page.locator('.coach-input [type="submit"]').click();
    await page.getByText('<img src=x onerror=alert(1)> 합성 응답',{exact:true}).waitFor();
    assert.equal(await page.locator('.coach-messages img').count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.coachTestRequest).includes('private')),false);
    await page.locator('[data-coach-playback]').click();
    await page.waitForFunction(()=>Boolean(window.voiceTestRequest));
    assert.match(await page.locator('[data-coach-voice-status]').innerText(),/음성 재생 중/);
    await page.evaluate(()=>window.voiceTestRequest.onLevel(0.7));
    assert.equal(await page.locator('.coach-hologram').evaluate(element=>element.style.getPropertyValue('--voice-level')),'0.7');
    await page.locator('[data-coach-close]').click();
    assert.equal(await page.evaluate(()=>window.voiceTestRequest.signal.aborted),true);
    await page.locator('[data-round-finish]').click();
    await page.evaluate(() => {
      RoundCoach.configureService({reply:()=>new Promise(resolve=>{window.lateCoachReply=resolve;})});
      RoundCoach.show({id:'synthetic-late-chat',started_at:0,ended_at:10});
    });
    await page.waitForFunction(()=>!document.querySelector('#coachQuestion').disabled);
    await page.locator('#coachQuestion').fill('지연된 합성 질문');
    await page.locator('.coach-input [type="submit"]').click();
    await page.waitForFunction(()=>typeof window.lateCoachReply==='function');
    await page.locator('[data-coach-close]').click();
    await page.evaluate(()=>window.lateCoachReply({text:'늦은 합성 응답'}));
    assert.equal(await page.locator('#roundCoachDialog').count(),0);
    await page.locator('[data-round-finish]').click();
    await page.evaluate(() => {
      RoundCoach.configureService(null);
      const session = { id: 'synthetic-duplicate', started_at: 1, ended_at: 2 };
      RoundCoach.show(session);
      RoundCoach.show(session);
    });
    assert.equal(await page.locator('#roundCoachDialog').count(), 1);
    await page.evaluate(() => clearAuthSession());
    assert.equal(await page.locator('#roundCoachDialog').count(), 0);
    console.log('Round coach: explicit close, next/end selection, duplicate guard, logout cleanup and responsive themes passed.');
  } finally {
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
