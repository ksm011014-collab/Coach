import './i18n.js';

import {coachingSummary} from './coach-summary.mjs';
export {coachingSummary} from './coach-summary.mjs';

export function coachingCues(session) {
  const summary=coachingSummary(session);
  const guard=summary.guard_observations;
  const cues=[];
  if (summary.tracking_unavailable_seconds!==undefined) cues.push(t('평가 제한: 약 {seconds}초는 추적 불안정 또는 분석 결과 공백으로 기록됐습니다. 운동 실패를 뜻하지 않습니다.', {seconds:summary.tracking_unavailable_seconds.toFixed(1)}));
  else cues.push(t('이 기록에는 추적 불안정 구간 정보가 없습니다.'));
  let report;
  try { report=typeof session.feedback_report==='string'?JSON.parse(session.feedback_report):session.feedback_report; } catch (_) {}
  const gaps=report?.version===1 && Array.isArray(report.tracking?.gaps)?report.tracking.gaps:[];
  const intervals=gaps.slice(0,5).filter(gap=>Number.isFinite(gap.start_ms) && Number.isFinite(gap.end_ms)).map(gap=>t('{start}~{end}초 ({reason})', {start:(gap.start_ms/1000).toFixed(1),end:(gap.end_ms/1000).toFixed(1),reason:gap.reason==='unreliable'?t('추적 불안정'):t('분석 공백')}));
  if (intervals.length) cues.push(t('라운드 시작 기준: {intervals}{suffix}', {intervals:intervals.join(' · '),suffix:gaps.length>5 || report.tracking.truncated?t(' · 일부 구간만 표시'):''}));
  if (!guard?.evaluated) return [...cues,t('가드 유지 여부를 평가할 저장된 관측 근거가 없습니다.'),t('다음 라운드는 두 손과 상체가 화면에 보이는지 확인한 뒤 시작하세요.')];
  if (guard.maintained) cues.push(t('잘된 점: {count}개 동작에서 반대손 가드를 유지한 것으로 감지됐습니다.', {count:guard.maintained}));
  if (guard.lowered>=2) {
    cues.push(t('반복 관측: {count}개 동작에서 반대손 가드가 내려간 것으로 감지됐습니다.', {count:guard.lowered}));
    cues.push(t('다음 라운드 집중 과제: 펀치 중 반대손 가드 위치를 확인하세요.'));
  } else cues.push(t('다음 라운드 집중 과제: 반대손 가드 위치를 유지하며 천천히 반복하세요.'));
  cues.push(t('저장된 시험 관측을 집계한 안내입니다. 가림이나 추적 오류일 수 있으며, 인식하지 못한 구간의 자세는 평가하지 않습니다.'));
  return cues;
}

export class CoachConversation {
  constructor({provider,session,language='ko',onState=()=>{},onMessage=()=>{},timeoutMs=20000}) {
    this.provider=provider;
    this.language=language==='en'?'en':'ko';
    this.summary=coachingSummary(session);
    this.onState=onState;
    this.onMessage=onMessage;
    this.timeoutMs=timeoutMs;
    this.messages=[];
    this.pending=null;
    this.closed=false;
  }

  get available() { return typeof this.provider?.reply==='function'; }

  async send(question) {
    if (this.closed || this.pending || !this.available) return false;
    const text=String(question||'').trim();
    if (!text || text.length>2000) return false;
    const controller=new AbortController();
    this.pending=controller;
    this.onState('loading');
    let timer;
    try {
      const request={summary:structuredClone(this.summary),history:structuredClone(this.messages.slice(-20)),question:text,language:this.language,signal:controller.signal};
      const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
      timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      const response=await Promise.race([Promise.resolve().then(()=>this.provider.reply(request)),cancelled]);
      if (this.closed || controller.signal.aborted) return false;
      if (typeof response?.text!=='string' || !response.text.trim() || response.text.length>16000) throw new Error('invalid_response');
      const pair=[{role:'user',text},{role:'assistant',text:response.text.trim()}];
      this.messages.push(...pair);
      this.messages=this.messages.slice(-20);
      for (const message of pair) { if (!this.closed) this.onMessage({...message}); }
      if (!this.closed) this.onState('ready');
      return true;
    } catch (error) {
      if (!this.closed) this.onState(controller.signal.aborted?'timeout':'error', error.userMessage);
      return false;
    } finally {
      clearTimeout(timer);
      if (this.pending===controller) this.pending=null;
    }
  }

  close() {
    this.closed=true;
    this.pending?.abort();
    this.messages=[];
    this.summary=null;
  }
}
