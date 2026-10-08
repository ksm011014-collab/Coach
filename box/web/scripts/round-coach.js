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
      const cues = coachingCues(session);
      const focus = cues.find(cue => cue.startsWith(t('다음 라운드 집중 과제: 펀치 중 반대손 가드 위치를 확인하세요.'))) || cues.find(cue => cue === t('다음 라운드 집중 과제: 반대손 가드 위치를 유지하며 천천히 반복하세요.')) || t('다음 라운드는 두 손과 상체가 화면에 보이는지 확인한 뒤 시작하세요.');
      target.querySelector('[data-coach-summary]').textContent += ` ${focus}`;
      for (const cue of cues) {
        const paragraph = document.createElement('p');
        paragraph.textContent = cue;
        summary.appendChild(paragraph);
      }
      let activeProvider = provider;
      if (!activeProvider) { try { activeProvider = await window.CoachApi?.connect(session, target, () => dialog === target); } catch (_) {} }
      if (dialog !== target) return;
      const {CoachVoice} = await import('/scripts/coach-voice.mjs');
      if (dialog !== target) return;
      const {createNativeVoice, loadVoiceSettings} = await import('/scripts/coach-native-voice.mjs');
      const voiceSettings = loadVoiceSettings(localStorage);
      let voiceProvider = activeProvider?.voice;
      if (!voiceProvider) {
        try {
          const {createSupertonicVoice} = await import('/scripts/coach-supertonic-voice.mjs');
          voiceProvider = await createSupertonicVoice(voiceSettings);
        } catch (_) {}
      }
      if (!voiceProvider && typeof desktopBridge !== 'undefined' && desktopBridge) {
        try { voiceProvider = await createNativeVoice(desktopBridge, voiceSettings); } catch (_) {}
      }
      if (dialog !== target) { voiceProvider?.stop(); return; }
      if (!activeProvider?.voice && typeof desktopBridge !== 'undefined' && desktopBridge) {
        const {withLocalInput} = await import('/scripts/coach-local-input.mjs');
        voiceProvider = withLocalInput(voiceProvider,(path,options)=>platformApiFetch(path,{...options,headers:{...options.headers,Authorization:`Bearer ${state.token}`}}));
      }
      if (dialog !== target) { voiceProvider?.stop(); return; }
      const input = target.querySelector('textarea');
      const send = target.querySelector('[type="submit"]');
      const status = target.querySelector('.coach-service-status');
      const messages = target.querySelector('.coach-messages');
      const microphone = target.querySelector('[data-coach-microphone]');
      const playback = target.querySelector('[data-coach-playback]');
      const voiceStatus = target.querySelector('[data-coach-voice-status]');
      let lastAnswer = target.querySelector('[data-coach-summary]').textContent;
      let voiceState = 'idle';
      const readyVoiceLabel = t('음성 대기') + (voiceProvider?.engine ? ` · ${voiceProvider.engine}` : '');
      voice = new CoachVoice({provider:voiceProvider,inputTimeoutMs:95000,language:window.BoxingI18n?.language || 'ko',onState:state=>{
        if (dialog!==target) return;
        voiceState = state;
        microphone.textContent = state === 'listening' ? t('인식하기') : t('음성 입력');
        const busy = ['preparing-input','preparing-output','listening','transcribing','playing'].includes(state);
        target.dataset.voiceState = state;
        playback.textContent = busy ? t('음성 중단') : t('답변 듣기');
        playback.disabled = !busy && !voice?.supports('speak');
        voiceStatus.setAttribute('aria-busy', String(state === 'transcribing' || state === 'preparing-input' || state === 'preparing-output'));
        voiceStatus.textContent = {idle:voice?.supports('listen') || voice?.supports('speak')?t('음성 대기'):t('음성 서비스 미연결'), 'preparing-input':t('마이크 준비 중'), 'preparing-output':t('음성 준비 중'),listening:t('마이크 수집 중 · 입력 중단 가능'),transcribing:t('음성을 텍스트로 변환 중'),speech_model_missing:t('음성인식 모델이 없습니다. 최신 Windows 배포본을 설치하세요.'),speech_no_voice:t('인식된 음성이 없습니다. 다시 말하거나 텍스트를 입력하세요.'),speech_busy:t('이전 음성 변환이 진행 중입니다. 잠시 후 다시 시도하세요.'),speech_voice_missing:t('선택 언어의 음성이 없습니다. Windows 설정의 언어 및 지역에서 음성을 설치하세요.'),playing:t('음성 재생 중'),denied:t('마이크 권한이 거부됐습니다. 텍스트로 질문할 수 있습니다.'),timeout:t('음성 처리 시간이 초과됐습니다.'),error:t('음성 처리 실패 · 다시 시도할 수 있습니다.')}[state];
        if (state === 'idle' && voice?.supports('speak')) voiceStatus.textContent = readyVoiceLabel;
      },onLevel:level=>{
        if (dialog===target) target.querySelector('.coach-hologram').style.setProperty('--voice-level',String(level));
      },onTranscript:text=>{
        if (dialog===target && !input.disabled) {
          input.value=text;
          queueMicrotask(()=>{if(dialog===target && conversation && !send.disabled) target.querySelector('form').requestSubmit();});
        }
      }});
      microphone.disabled = !voice.supports('listen');
      if (voice.supports('listen') || voice.supports('speak')) voiceStatus.textContent = readyVoiceLabel;
      microphone.addEventListener('click',()=>voiceState === 'listening' ? voice?.finishInput() : voice?.listen());
      playback.addEventListener('click',()=>{
        if (['preparing-input','preparing-output','listening','transcribing','playing'].includes(voiceState)) voice?.stop();
        else { voiceSettings.enabled = true; voice?.speak(lastAnswer); }
      });
      const hasLanguageVoice = !voiceProvider?.voices || voiceProvider.voices.some(item => item.language.toLowerCase().startsWith((window.BoxingI18n?.language || 'ko') + '-'));
      playback.disabled = !voice.supports('speak') || !hasLanguageVoice;
      if (!hasLanguageVoice) voiceStatus.textContent = t('선택 언어의 음성이 없습니다. Windows 설정의 언어 및 지역에서 음성을 설치하세요.');
      if (voiceSettings.enabled && voiceSettings.autoRead && hasLanguageVoice) voice.speak(target.querySelector('[data-coach-summary]').textContent);
      if (!activeProvider) {
        input.disabled = false;
        input.placeholder = t('텍스트를 입력할 수 있습니다. AI 연결을 확인하세요.');
        status.textContent = t('AI 대화 서비스가 연결되지 않았습니다.');
        return;
      }
      conversation = new CoachConversation({provider:activeProvider,session,language:window.BoxingI18n?.language || 'ko',onState:(state, errorMessage)=>{
        if (dialog !== target) return;
        input.disabled = send.disabled = state === 'loading';
        microphone.disabled = state === 'loading' || !voice?.supports('listen');
        status.textContent = {loading:t('AI 응답을 기다리고 있습니다.'),ready:t('AI 대화 연결됨 · 질문과 운동 요약이 대화 서비스로 전달됩니다.'),timeout:t('응답 시간이 초과됐습니다. 다시 전송할 수 있습니다.'),error:t('답변을 받지 못했습니다. 다시 전송할 수 있습니다.')}[state];
        if (state === 'error' && errorMessage) status.textContent = errorMessage;
      },onMessage:message=>{
        if (dialog !== target) return;
        const item = document.createElement('article');
        item.className = `coach-message coach-message-${message.role === 'user' ? 'user' : 'assistant'}`;
        const name = document.createElement('strong');
        name.textContent = message.role==='user'?t('나'):t('AI 코치');
        const text = document.createElement('p');
        text.textContent = message.text;
        item.append(name,text);
        messages.appendChild(item);
        while (messages.children.length>41) messages.children[1].remove();
        messages.scrollTop = messages.scrollHeight;
        if (message.role==='assistant') {
          lastAnswer=message.text;
          playback.disabled=!voice?.supports('speak') || !hasLanguageVoice;
          if (voiceSettings.enabled && voiceSettings.autoRead && hasLanguageVoice) voice?.speak(lastAnswer);
        }
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

  function hologram() {
    const ticks = (count, radius, length, majorEvery = 6) => Array.from({length:count}, (_, index) => {
      const major = index % majorEvery === 0;
      return `<path class="${major ? 'holo-tick-major' : 'holo-tick'}" transform="rotate(${index * 360 / count} 200 200)" d="M200 ${200 - radius}v${major ? length : length * .45}"/>`;
    }).join('');
    const teeth = Array.from({length:60}, (_, index) => `<path transform="rotate(${index * 6} 200 200)" d="M197 54h6v8h-6z"/>`).join('');
    const vanes = Array.from({length:36}, (_, index) => `<path transform="rotate(${index * 10} 200 200)" d="M197 104l5 1 2 15-5-1z"/>`).join('');
    return `<svg class="coach-holo-instrument" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="coach-holo-field"><stop stop-color="#1588a4" stop-opacity=".22"/><stop offset=".65" stop-color="#09657b" stop-opacity=".09"/><stop offset="1" stop-color="#03202b" stop-opacity="0"/></radialGradient>
        <radialGradient id="coach-holo-diaphragm" cx="42%" cy="35%"><stop stop-color="#163c4d"/><stop offset=".66" stop-color="#08232f"/><stop offset=".88" stop-color="#0e4d60"/><stop offset="1" stop-color="#041923"/></radialGradient>
        <linearGradient id="coach-holo-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d6ffff"/><stop offset=".35" stop-color="#54cedb"/><stop offset=".7" stop-color="#21718e"/><stop offset="1" stop-color="#b4faff"/></linearGradient>
        <pattern id="coach-holo-mesh" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r=".65" fill="#8bdbe5" opacity=".3"/></pattern>
      </defs>
      <circle cx="200" cy="200" r="198" fill="url(#coach-holo-field)"/>
      <g class="holo-registration"><path d="M16 186v-14h14M370 172h14v14M16 214v14h14M370 228h14v-14M186 16h28M186 384h28"/><circle cx="200" cy="200" r="181"/><path d="M200 12v12M200 376v12M12 200h12M376 200h12"/></g>
      <g class="holo-rotor holo-rotor-outer">${ticks(120,174,10)}<circle class="holo-track" cx="200" cy="200" r="159"/><circle class="holo-arc holo-arc-outer" cx="200" cy="200" r="162" pathLength="360" stroke-dasharray="74 16 32 58 74 16 32 58"/></g>
      <g class="holo-rotor holo-rotor-geared"><g class="holo-teeth">${teeth}</g><circle class="holo-track" cx="200" cy="200" r="136"/><circle class="holo-arc holo-arc-middle" cx="200" cy="200" r="130" pathLength="360" stroke-dasharray="98 22"/><circle class="holo-fine" cx="200" cy="200" r="123"/></g>
      <g class="holo-rotor holo-rotor-inner">${ticks(72,116,7)}<circle class="holo-arc holo-arc-inner" cx="200" cy="200" r="103" pathLength="360" stroke-dasharray="42 18"/><g class="holo-vanes">${vanes}</g></g>
      <g class="holo-resonance"><circle cx="200" cy="200" r="86"/><circle cx="200" cy="200" r="94"/></g>
      <g class="coach-core"><circle class="holo-core-rim" cx="200" cy="200" r="77"/><circle cx="200" cy="200" r="70" fill="url(#coach-holo-diaphragm)"/><circle cx="200" cy="200" r="65" fill="url(#coach-holo-mesh)"/><circle class="holo-core-contour" cx="200" cy="200" r="61"/><circle class="holo-core-contour" cx="200" cy="200" r="53"/><circle class="holo-core-contour" cx="200" cy="200" r="43"/><circle class="holo-aperture" cx="200" cy="200" r="26"/><circle class="holo-pilot" cx="200" cy="200" r="3"/></g>
      <g class="holo-indicators"><path d="M194 40h12M194 360h12M40 194v12M360 194v12"/><circle cx="200" cy="46" r="2"/><circle cx="354" cy="200" r="2"/><circle cx="200" cy="354" r="2"/><circle cx="46" cy="200" r="2"/></g>
    </svg>`;
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
        <span class="coach-eyebrow"><img class="coach-brand-icon" src="/brand/seonrang-mark.png" alt="" /> JDC / ${t("라운드 리뷰")}</span>
        <h3>${t("다음 라운드를 준비하는 시간")}</h3>
        <div class="coach-round-duration"><span>${t("운동 시간")}</span><strong data-round-duration></strong></div>
        <dl class="coach-round-metrics"><div><dt>${t("라운드 점수")}</dt><dd data-round-points></dd></div><div><dt>${t("평균 수행 품질")}</dt><dd data-round-quality></dd></div></dl>
        <p class="coach-evidence-note">${t("저장된 관측을 바탕으로 돌아봅니다. 감지되지 않은 동작은 평가하지 않습니다.")}</p>
        <div class="coach-hologram" aria-hidden="true">${hologram()}</div>
        <strong>AI COACH</strong><span data-coach-voice-status role="status">${t("음성 서비스 미연결")}</span>
      </section>
      <section class="coach-conversation">
        <header><h2 id="roundCoachTitle">${t("라운드 피드백")}</h2><button type="button" data-coach-close>${t("채팅 종료")}</button></header>
        <div class="coach-model-controls"></div>
        <div class="coach-messages" role="log" aria-label="${t("라운드 요약과 대화")}"><article class="coach-message coach-message-summary"><strong>${t("운동 기록 요약")}</strong><p data-coach-summary></p><details><summary>${t("저장된 관측 보기")}</summary><p data-coach-motion></p></details></article></div>
        <p class="coach-service-status" role="status">${t("AI 대화 서비스가 연결되지 않았습니다.")}</p>
        <small class="coach-usage"></small><small class="coach-usage-warning" role="status"></small>
        <form class="coach-input"><label for="coachQuestion">${t("질문")}</label><textarea id="coachQuestion" rows="2" placeholder="${t("AI 서비스 연결 후 대화할 수 있습니다")}" disabled></textarea><div><button type="button" data-coach-microphone disabled>${t("음성 입력")}</button><button type="button" data-coach-playback disabled>${t("답변 듣기")}</button><button type="submit" disabled>${t("전송")}</button></div></form>
      </section>
    </div>`;
    const duration = Math.max(0, Math.round(session.ended_at - session.started_at));
    let report;
    try { report = typeof session.feedback_report === 'string' ? JSON.parse(session.feedback_report) : session.feedback_report; } catch (_) {}
    const ending = endReason === 'timer' ? t('설정한 라운드 시간이 끝났습니다.') : endReason === 'manual' ? t('직접 라운드를 종료했습니다.') : '';
    const measuredDuration = report?.version === 1 && Number.isFinite(report.duration_ms) ? Math.floor(report.duration_ms/1000) : duration;
    dialog.querySelector('[data-round-duration]').textContent = `${String(Math.floor(measuredDuration/60)).padStart(2,'0')}:${String(measuredDuration%60).padStart(2,'0')}`;
    const assessed = report?.version === 1 && report.status === 'experimental';
    dialog.querySelector('[data-round-points]').textContent = assessed && Number.isFinite(report.total_points) ? t('{points}점', {points:report.total_points}) : t('평가 없음');
    dialog.querySelector('[data-round-quality]').textContent = assessed && Number.isFinite(report.mean_quality) ? `${report.mean_quality} / 100` : t('평가 없음');
    dialog.querySelector('[data-coach-summary]').textContent = [ending, t('이번 라운드 운동 시간은 {minutes}분 {seconds}초입니다. 운동 기록을 저장했습니다.', { minutes: Math.floor(measuredDuration/60), seconds: measuredDuration%60 })].filter(Boolean).join(' ');
    const motionSummary = dialog.querySelector('[data-coach-motion]');
    if (report?.version === 1 && report.status === 'experimental' && report.counts) {
      motionSummary.textContent = t('잽 {jab}회 · 훅 {hook}회 · 어퍼컷 {uppercut}회 · 원투 {oneTwo}회. 누적 {points}점 · 평균 수행 품질 {quality}. 시험 판정이며 실제 정확도 검증 전입니다. 인식되지 않은 동작은 실패로 집계하지 않습니다.', { jab: report.counts.jab, hook: report.counts.hook, uppercut: report.counts.uppercut, oneTwo: report.counts.one_two, points: report.total_points, quality: report.mean_quality ?? t('평가 없음') });
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
