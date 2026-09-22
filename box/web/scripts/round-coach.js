window.RoundCoach = (() => {
  let dialog = null;
  let choices = null;
  let lastSession = null;
  let onState = () => {};
  let provider = null;
  let conversation = null;
  let voice = null;

  function configureService(service) {
    if (dialog) throw new Error(t('대화를 종료한 뒤 서비스를 변경하세요'));
    if (service !== null && typeof service?.reply !== 'function') throw new Error(t('대화 서비스 인터페이스를 확인하세요'));
    provider = service;
  }

  async function connectConversation(session, target) {
    try {
      const {CoachConversation,coachingCues} = await import('/scripts/coach-conversation.mjs');
      if (dialog !== target) return;
      const summary = target.querySelector('[data-coach-motion]').parentElement;
      for (const cue of coachingCues(session)) {
        const paragraph = document.createElement('p');
        paragraph.textContent = cue;
        summary.appendChild(paragraph);
      }
      if (!provider) return;
      const {CoachVoice} = await import('/scripts/coach-voice.mjs');
      if (dialog !== target) return;
      const input = target.querySelector('textarea');
      const send = target.querySelector('[type="submit"]');
      const status = target.querySelector('.coach-service-status');
      const messages = target.querySelector('.coach-messages');
      const microphone = target.querySelector('[data-coach-microphone]');
      const playback = target.querySelector('[data-coach-playback]');
      const stopVoice = target.querySelector('[data-coach-voice-stop]');
      const voiceStatus = target.querySelector('[data-coach-voice-status]');
      let lastAnswer = '';
      voice = new CoachVoice({provider:provider.voice,language:window.BoxingI18n?.language || 'ko',onState:state=>{
        if (dialog!==target) return;
        const busy = ['preparing-input','preparing-output','listening','playing'].includes(state);
        stopVoice.disabled = !busy;
        voiceStatus.textContent = {idle:voice?.supports('listen') || voice?.supports('speak')?t('음성 대기'):t('음성 서비스 미연결'), 'preparing-input':t('마이크 준비 중'), 'preparing-output':t('음성 준비 중'),listening:t('마이크 수집 중 · 입력 중단 가능'),playing:t('음성 재생 중 · 진폭 정보는 제공되는 경우만 반영'),denied:t('마이크 권한이 거부됐습니다. 텍스트로 질문할 수 있습니다.'),timeout:t('음성 처리 시간이 초과됐습니다.'),error:t('음성 처리 실패 · 다시 시도할 수 있습니다.')}[state];
      },onLevel:level=>{
        if (dialog===target) target.querySelector('.coach-hologram').style.setProperty('--voice-level',String(level));
      },onTranscript:text=>{
        if (dialog===target && !input.disabled) { input.value=text; input.focus(); }
      }});
      microphone.disabled = !voice.supports('listen');
      if (voice.supports('listen') || voice.supports('speak')) voiceStatus.textContent = t('음성 대기');
      microphone.addEventListener('click',()=>voice?.listen());
      playback.addEventListener('click',()=>voice?.speak(lastAnswer));
      stopVoice.addEventListener('click',()=>voice?.stop());
      conversation = new CoachConversation({provider,session,language:window.BoxingI18n?.language || 'ko',onState:state=>{
        if (dialog !== target) return;
        input.disabled = send.disabled = state === 'loading';
        microphone.disabled = state === 'loading' || !voice?.supports('listen');
        status.textContent = {loading:t('AI 응답을 기다리고 있습니다.'),ready:t('AI 대화 연결됨 · 질문과 운동 요약이 대화 서비스로 전달됩니다.'),timeout:t('응답 시간이 초과됐습니다. 다시 전송할 수 있습니다.'),error:t('답변을 받지 못했습니다. 다시 전송할 수 있습니다.')}[state];
      },onMessage:message=>{
        if (dialog !== target) return;
        const item = document.createElement('article');
        item.className = 'coach-message';
        const name = document.createElement('strong');
        name.textContent = message.role==='user'?t('나'):t('AI 코치');
        const text = document.createElement('p');
        text.textContent = message.text;
        item.append(name,text);
        messages.appendChild(item);
        while (messages.children.length>41) messages.children[1].remove();
        messages.scrollTop = messages.scrollHeight;
        if (message.role==='assistant') { lastAnswer=message.text; playback.disabled=!voice?.supports('speak'); }
      }});
      input.disabled = send.disabled = false;
      input.maxLength = 2000;
      input.placeholder = t('운동에 대해 질문하세요');
      status.textContent = t('AI 대화 연결됨 · 질문과 운동 요약이 대화 서비스로 전달됩니다.');
      target.querySelector('form').addEventListener('submit',async event=>{
        event.preventDefault();
        const active = conversation;
        voice?.stop();
        const sent = await active?.send(input.value);
        if (dialog===target && sent) { input.value=''; input.focus(); }
      });
    } catch (_) {
      if (dialog===target) target.querySelector('.coach-service-status').textContent = t('대화 서비스를 준비하지 못했습니다. 운동 기록은 저장되어 있습니다.');
    }
  }

  function clear() {
    voice?.close();
    voice = null;
    conversation?.close();
    conversation = null;
    dialog?.close();
    dialog?.remove();
    choices?.remove();
    dialog = null;
    choices = null;
    onState();
  }

  function show(session, { onNext, onEnd, onChange = () => {}, endReason } = {}) {
    if (!session?.ended_at || lastSession === session.id) return;
    clear();
    lastSession = session.id;
    onState = onChange;
    const previousFocus = document.activeElement;
    dialog = document.createElement('dialog');
    dialog.id = 'roundCoachDialog';
    dialog.className = 'round-coach';
    dialog.setAttribute('aria-labelledby', 'roundCoachTitle');
    dialog.innerHTML = `<div class="round-coach-layout">
      <section class="coach-hologram-panel" aria-label="${t("AI 코치 대기")}">
        <div class="coach-hologram" aria-hidden="true"><div class="coach-orbit"></div><div class="coach-core"></div><div class="coach-orbit coach-orbit-cross"></div></div>
        <strong>AI COACH</strong><span data-coach-voice-status role="status">${t("음성 서비스 미연결")}</span>
      </section>
      <section class="coach-conversation">
        <header><h2 id="roundCoachTitle">${t("라운드 피드백")}</h2><button type="button" data-coach-close>${t("채팅 종료")}</button></header>
        <div class="coach-messages" role="log" aria-label="${t("라운드 요약과 대화")}"><article class="coach-message"><strong>${t("운동 기록 요약")}</strong><p data-coach-summary></p><p data-coach-motion></p></article></div>
        <p class="coach-service-status" role="status">${t("AI 대화 서비스가 연결되지 않았습니다.")}</p>
        <form class="coach-input"><label for="coachQuestion">${t("질문")}</label><textarea id="coachQuestion" rows="2" placeholder="${t("AI 서비스 연결 후 대화할 수 있습니다")}" disabled></textarea><div><button type="button" data-coach-microphone disabled>${t("음성 입력")}</button><button type="button" data-coach-playback disabled>${t("답변 듣기")}</button><button type="button" data-coach-voice-stop disabled>${t("음성 중단")}</button><button type="submit" disabled>${t("전송")}</button></div></form>
      </section>
    </div>`;
    const duration = Math.max(0, Math.round(session.ended_at - session.started_at));
    dialog.querySelector('[data-coach-summary]').textContent = `이번 라운드 운동 시간은 ${Math.floor(duration / 60)}분 ${duration % 60}초입니다. 운동 기록을 저장했습니다.`;
    let report;
    try { report = typeof session.feedback_report === 'string' ? JSON.parse(session.feedback_report) : session.feedback_report; } catch (_) {}
    const ending = endReason === 'timer' ? t('설정한 라운드 시간이 끝났습니다.') : endReason === 'manual' ? t('직접 라운드를 종료했습니다.') : '';
    const measuredDuration = report?.version === 1 && Number.isFinite(report.duration_ms) ? Math.floor(report.duration_ms/1000) : duration;
    dialog.querySelector('[data-coach-summary]').textContent = `${ending} 이번 라운드 운동 시간은 ${Math.floor(measuredDuration/60)}분 ${measuredDuration%60}초입니다. 운동 기록을 저장했습니다.`;
    const motionSummary = dialog.querySelector('[data-coach-motion]');
    if (report?.version === 1 && report.status === 'experimental' && report.counts) {
      motionSummary.textContent = `잽 ${report.counts.jab}회 · 훅 ${report.counts.hook}회 · 어퍼컷 ${report.counts.uppercut}회 · 원투 ${report.counts.one_two}회. 누적 ${report.total_points}점 · 평균 수행 품질 ${report.mean_quality ?? t('평가 없음')}. 시험 판정이며 실제 정확도 검증 전입니다. 인식되지 않은 동작은 실패로 집계하지 않습니다.`;
    } else {
      motionSummary.textContent = t('평가 가능한 동작 기록이 없습니다. 수행 품질을 평가하지 않았습니다.');
    }
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
    dialog.querySelector('[data-coach-close]').addEventListener('click', () => {
      voice?.close();
      voice = null;
      conversation?.close();
      conversation = null;
      dialog.close();
      dialog.remove();
      dialog = null;
      choices = document.createElement('section');
      choices.className = 'overlay round-next-actions';
      choices.id = 'roundNextActions';
      choices.setAttribute('aria-label', t('라운드 종료 후 선택'));
      choices.innerHTML = `<strong>${t("라운드 완료")}</strong><button type="button" data-round-next>${t("다음 라운드 시작")}</button><button type="button" data-round-finish>${t("세션 종료")}</button>`;
      choices.querySelector('[data-round-next]').addEventListener('click', () => { clear(); onNext?.(); });
      choices.querySelector('[data-round-finish]').addEventListener('click', () => { clear(); onEnd?.(); if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus(); });
      document.querySelector('#hud').appendChild(choices);
      choices.querySelector('button').focus();
      onState();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    connectConversation(session, dialog);
    dialog.querySelector('[data-coach-close]').focus();
    onState();
  }

  return { show, clear, configureService, isBlocking: () => Boolean(dialog || choices) };
})();
