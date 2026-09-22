import './i18n.js';

export function coachingSummary(session) {
  let report;
  try { report = typeof session.feedback_report==='string'?JSON.parse(session.feedback_report):session.feedback_report; } catch (_) {}
  const summary = {duration_seconds:Math.max(0,Math.round(session.ended_at-session.started_at)),analysis_status:'unavailable'};
  if (report?.version===1 && Number.isFinite(report.duration_ms)) summary.duration_seconds=Math.max(0,Math.floor(report.duration_ms/1000));
  if (report?.version===1 && Number.isFinite(report.tracking?.total_ms)) summary.tracking_unavailable_seconds=report.tracking.total_ms/1000;
  if (report?.version!==1 || report.status!=='experimental') return summary;
  summary.analysis_status='experimental';
  summary.counts=Object.fromEntries(['jab','hook','uppercut','one_two'].map(label=>[label,Number.isInteger(report.counts?.[label])?Math.max(0,report.counts[label]):0]));
  summary.total_points=Number.isFinite(report.total_points)?report.total_points:0;
  summary.mean_quality=Number.isFinite(report.mean_quality)?report.mean_quality:null;
  const guards=(Array.isArray(report.events)?report.events:[]).map(event=>event?.guard_ratio).filter(value=>Number.isFinite(value) && value>=0 && value<=1);
  summary.guard_observations={evaluated:guards.length,maintained:guards.filter(value=>value>=0.9).length,lowered:guards.filter(value=>value<0.5).length};
  return summary;
}

export function coachingCues(session) {
  const summary=coachingSummary(session);
  const guard=summary.guard_observations;
  const cues=[];
  if (summary.tracking_unavailable_seconds!==undefined) cues.push(`평가 제한: 약 ${summary.tracking_unavailable_seconds.toFixed(1)}초는 추적 불안정 또는 분석 결과 공백으로 기록됐습니다. 운동 실패를 뜻하지 않습니다.`);
  else cues.push(t('이 기록에는 추적 불안정 구간 정보가 없습니다.'));
  let report;
  try { report=typeof session.feedback_report==='string'?JSON.parse(session.feedback_report):session.feedback_report; } catch (_) {}
  const gaps=report?.version===1 && Array.isArray(report.tracking?.gaps)?report.tracking.gaps:[];
  const intervals=gaps.slice(0,5).filter(gap=>Number.isFinite(gap.start_ms) && Number.isFinite(gap.end_ms)).map(gap=>`${(gap.start_ms/1000).toFixed(1)}~${(gap.end_ms/1000).toFixed(1)}초 (${gap.reason==='unreliable'?t('추적 불안정'):t('분석 공백')})`);
  if (intervals.length) cues.push(`라운드 시작 기준: ${intervals.join(' · ')}${gaps.length>5 || report.tracking.truncated?t(' · 일부 구간만 표시'):''}`);
  if (!guard?.evaluated) return [...cues,t('가드 유지 여부를 평가할 저장된 관측 근거가 없습니다.'),t('다음 라운드는 두 손과 상체가 화면에 보이는지 확인한 뒤 시작하세요.')];
  if (guard.maintained) cues.push(`잘된 점: ${guard.maintained}개 동작에서 반대손 가드를 유지한 것으로 감지됐습니다.`);
  if (guard.lowered>=2) {
    cues.push(`반복 관측: ${guard.lowered}개 동작에서 반대손 가드가 내려간 것으로 감지됐습니다.`);
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
    } catch (_) {
      if (!this.closed) this.onState(controller.signal.aborted?'timeout':'error');
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
