window.CoachApi = (() => {
  function formatUsage(usage) {
    const token = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : t('측정되지 않음');
    const scope = {self:t('본인'),center:t('센터'),platform:t('플랫폼')}[usage.scope] || t('측정되지 않음');
    const start = usage.period_start ? new Date(usage.period_start).toISOString().slice(0,10) : '—';
    const end = usage.period_end ? new Date(usage.period_end).toISOString().slice(0,16).replace('T',' ') : '—';
    return t('{scope} · {start} ~ {end} UTC · 입력 {input} / 출력 {output} 토큰 · 미측정 요청 {unknown}건',
      {scope,start,end,input:token(usage.input_tokens),output:token(usage.output_tokens),unknown:token(usage.unmeasured_requests)});
  }

  async function connect(session, target, isCurrent) {
    const config = await api('/coach/models');
    if (!isCurrent() || !config.available || !Array.isArray(config.models) || !config.models.length) return null;
    const controls = target.querySelector('.coach-model-controls');
    const label = document.createElement('label');
    label.textContent = t('AI 모델');
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('AI 모델'));
    for (const model of config.models) {
      const option = document.createElement('option');
      option.value = model.model_id;
      option.textContent = model.display_name;
      select.appendChild(option);
    }
    let preferred;
    try { preferred = localStorage.getItem('boxing_coach_model'); } catch (_) {}
    select.value = config.models.some(model=>model.model_id===preferred) ? preferred : config.default_model || config.models[0].model_id;
    select.addEventListener('change',()=>{ try { localStorage.setItem('boxing_coach_model',select.value); } catch (_) {} });
    label.appendChild(select);
    controls.appendChild(label);
    const usage = target.querySelector('.coach-usage');
    async function updateUsage() {
      try {
        const result = await api('/coach/usage');
        if (isCurrent()) usage.textContent = formatUsage(result);
      } catch (_) { if (isCurrent()) usage.textContent = t('사용량을 조회하지 못했습니다. 측정값을 확인할 수 없습니다.'); }
    }
    await updateUsage();
    let previous = null;
    return {
      async reply(request) {
        const input={session_id:session.id,model:select.value,language:request.language,question:request.question,history:request.history};
        const signature=JSON.stringify(input);
        if (!previous || previous.signature!==signature) previous={signature,id:crypto.randomUUID()};
        select.disabled=true;
        try {
          const result=await api('/coach/reply',{method:'POST',body:JSON.stringify({...input,request_id:previous.id}),signal:request.signal});
          if (isCurrent()) {
            target.querySelector('.coach-usage-warning').textContent=result.usage_recorded===false ? t('응답은 받았지만 사용량 저장을 확인하지 못했습니다. 같은 질문을 다시 전송하지 마세요.') : '';
            await updateUsage();
          }
          return result;
        } finally { select.disabled=false; }
      },
    };
  }
  async function renderSettings(target) {
    if (!target) return;
    const token=state.token;
    const language=BoxingI18n.language;
    const current=()=>target.isConnected && state.token===token && BoxingI18n.language===language;
    try {
      const config=await api('/coach/models');
      if (!current()) return;
      if (config.reason==='central_required') { target.textContent=t('AI 대화는 중앙 서비스 연결 후 사용할 수 있습니다.'); return; }
      const usage=await api('/coach/usage');
      if (!current()) return;
      target.textContent=formatUsage(usage);
      const note=document.createElement('p');
      note.textContent=t('허용된 모델은 라운드 종료 후 채팅에서 선택할 수 있습니다. 비용 추정은 표시하지 않습니다.');
      target.appendChild(note);
    } catch (_) { if (current()) target.textContent=t('사용량을 조회하지 못했습니다. 측정값을 확인할 수 없습니다.'); }
  }
  return Object.freeze({connect,formatUsage,renderSettings});
})();
