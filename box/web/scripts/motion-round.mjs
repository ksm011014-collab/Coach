import { PunchRecognizer } from './motion-recognizer.mjs';

const labels = {jab:'잽',hook:'훅',uppercut:'어퍼컷',one_two:'원투'};

export class MotionRound {
  constructor({stance='orthodox',startedAt,feedbackMode='summary',recognizer} = {}) {
    if (!Number.isFinite(startedAt)) throw new Error('라운드 시작 시간이 필요합니다');
    if (!['summary','event'].includes(feedbackMode)) throw new Error('피드백 설정을 확인하세요');
    this.recognizer = recognizer || new PunchRecognizer({stance});
    this.stance = stance;
    this.startedAt = startedAt;
    this.feedbackMode = feedbackMode;
    this.events = [];
    this.identities = new Set();
    this.pendingFeedback = [];
    this.lastFeedbackAt = 0;
    this.lastFeedback = '';
    this.observed = false;
    this.tracking = {gaps:[],total_ms:0,truncated:false};
    this.lastFrameAt = 0;
    this.lastFrameValid = null;
    this.finalReport = null;
  }

  elapsed(timestamp) {
    return Math.min(3600000,Math.max(0,Math.floor(timestamp-this.startedAt)));
  }

  collect(events, timestamp) {
    for (const candidate of events) {
      if (this.identities.has(candidate.id) || this.events.length >= 1000) continue;
      const event = {id:candidate.id,label:candidate.label,hand:candidate.hand,
        start_ms:Math.floor(candidate.start_ms),end_ms:Math.floor(candidate.end_ms),
        quality:Math.round(candidate.quality),confidence:candidate.confidence};
      if (!labels[event.label] || !Number.isFinite(event.quality) || event.quality<0 || event.quality>100
        || !Number.isFinite(event.confidence) || event.confidence<0.65 || event.confidence>1
        || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)
        || event.start_ms<0 || event.end_ms<event.start_ms || event.end_ms>timestamp
        || !['left','right','both'].includes(event.hand)
        || (event.label==='one_two')!==(event.hand==='both')
        || (event.label==='jab' && event.hand!==(this.stance==='orthodox'?'left':'right'))) continue;
      if (this.events.some(previous => event.end_ms<previous.end_ms || (event.start_ms<previous.end_ms
        && (event.hand==='both' || previous.hand==='both' || event.hand===previous.hand)))) continue;
      event.points = Math.max(1,Math.round(event.quality/10))*(event.label==='one_two'?2:1);
      const guard = candidate.evidence?.otherGuard;
      if (Number.isFinite(guard) && guard>=0 && guard<=1) event.guard_ratio = guard;
      this.identities.add(event.id);
      this.events.push(event);
      this.pendingFeedback.push({...event,evidence:candidate.evidence});
    }
  }

  update(frame) {
    if (this.finalReport || !Number.isFinite(frame.timestamp) || frame.timestamp<this.startedAt) return;
    const timestamp = this.elapsed(frame.timestamp);
    if (timestamp<this.lastFrameAt) return;
    this.trackUntil(timestamp);
    this.lastFrameAt = timestamp;
    this.lastFrameValid = Boolean(frame.valid);
    this.observed ||= Boolean(frame.valid);
    this.collect(this.recognizer.update({...frame,timestamp}),timestamp);
  }

  trackUntil(timestamp) {
    const append = (start_ms,end_ms,reason) => {
      if (end_ms<=start_ms) return;
      this.tracking.total_ms += end_ms-start_ms;
      const previous = this.tracking.gaps.at(-1);
      if (!this.tracking.truncated && previous?.end_ms===start_ms && previous.reason===reason) previous.end_ms=end_ms;
      else if (this.tracking.gaps.length<200) this.tracking.gaps.push({start_ms,end_ms,reason});
      else this.tracking.truncated=true;
    };
    const staleAt = Math.min(timestamp,this.lastFrameAt+250);
    if (this.lastFrameValid===false) append(this.lastFrameAt,staleAt,'unreliable');
    else if (this.lastFrameValid===null) append(this.lastFrameAt,staleAt,'no_result');
    append(staleAt,timestamp,'no_result');
  }

  feedback(timestamp) {
    if (this.finalReport || !Number.isFinite(timestamp)) return null;
    const elapsed = this.elapsed(timestamp);
    const interval = this.feedbackMode==='summary'?5000:1000;
    if (elapsed-this.lastFeedbackAt<interval || !this.pendingFeedback.length) return null;
    const pending = this.pendingFeedback.splice(0);
    const events = this.feedbackMode==='event'?pending.slice(-1):pending;
    this.lastFeedbackAt = elapsed;
    const counts = {};
    for (const event of events) counts[event.label]=(counts[event.label]||0)+1;
    const guards = events.map(event=>event.evidence?.otherGuard).filter(value=>Number.isFinite(value) && value>=0 && value<=1);
    let cue = '';
    if (guards.length===events.length && guards.every(value=>value>=0.9)) cue = ' · 반대손 가드를 유지했어요';
    else if (guards.length>=2 && guards.filter(value=>value<0.5).length>=2) cue = ' · 반대손 가드가 내려간 것으로 감지됐어요. 가드 위치를 확인하세요';
    const message = Object.entries(counts).map(([label,count])=>`${labels[label]} ${count}회`).join(' · ')+' 감지'+cue+' · 시험 판정';
    if (message===this.lastFeedback) return null;
    this.lastFeedback = message;
    return message;
  }

  get totalPoints() {
    return this.events.reduce((total,event)=>total+event.points,0);
  }

  finish(timestamp) {
    if (this.finalReport) return structuredClone(this.finalReport);
    if (!Number.isFinite(timestamp)) throw new Error('라운드 종료 시간이 필요합니다');
    const duration = this.elapsed(timestamp);
    if (duration<this.lastFrameAt) throw new Error('종료 시간이 마지막 관측보다 빠릅니다');
    this.trackUntil(duration);
    this.collect(this.recognizer.flush(duration,true),duration);
    this.finalReport = {version:1,status:this.observed?'experimental':'unavailable',algorithm:'rules-v1',
      stance:this.stance,duration_ms:duration,events:structuredClone(this.events),tracking:structuredClone(this.tracking)};
    return structuredClone(this.finalReport);
  }
}
