const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
const clamp = value => Math.max(0, Math.min(1, value));

export function classifyTrajectory(samples, baseline) {
  if (samples.length < 4) return null;
  const duration = samples.at(-1).timestamp - samples[0].timestamp;
  if (duration < 160 || duration > 1800) return null;
  let lateral = 0;
  let upward = 0;
  let forward = 0;
  let maximumAngle = 0;
  for (const sample of samples) {
    lateral = Math.max(lateral, Math.abs(sample.position.x - baseline.x));
    upward = Math.max(upward, baseline.y - sample.position.y);
    forward = Math.max(forward, baseline.z - sample.position.z);
    maximumAngle = Math.max(maximumAngle, sample.elbowAngle);
  }
  const choices = [];
  if (forward >= 0.55 && maximumAngle >= 150 && upward < 0.55) choices.push('straight');
  if (upward >= 0.6 && upward > lateral * 1.25 && maximumAngle < 150) choices.push('uppercut');
  if (lateral >= 0.65 && lateral > upward * 1.25 && maximumAngle >= 65 && maximumAngle < 150) choices.push('hook');
  if (choices.length !== 1) return null;
  const label = choices[0];
  if (label !== 'straight' && samples.some(sample => sample.projected?.angle >= 155 && sample.projected?.reach >= 0.97)) return null;
  const form = label === 'straight' ? clamp((maximumAngle - 145) / 25) : clamp(1 - Math.abs(maximumAngle - 100) / 65);
  const otherGuard = samples.every(sample => typeof sample.otherGuard === 'boolean') ? samples.filter(sample => sample.otherGuard).length / samples.length : null;
  const recovery = clamp(1 - distance(samples.at(-1).position, baseline) / 0.3);
  return { label, confidence: Math.min(...samples.map(sample => sample.confidence)), quality: Math.round(100 * (0.4 * form + 0.3 * (otherGuard ?? 0) + 0.3 * recovery)), evidence: { lateral, upward, forward, maximumAngle, otherGuard, recovery }, start_ms: samples[0].timestamp, end_ms: samples.at(-1).timestamp };
}

export class PunchRecognizer {
  constructor({ stance = 'orthodox', combinationMs = 900 } = {}) {
    if (!['orthodox', 'southpaw'].includes(stance)) throw new Error('지원하지 않는 스탠스');
    this.stance = stance;
    this.combinationMs = combinationMs;
    this.reset();
  }

  reset() {
    this.hands = { left: {}, right: {} };
    this.lastTimestamp = -Infinity;
    this.pendingJab = null;
    this.pendingCross = null;
    this.sequence = 0;
  }

  invalidate() {
    this.hands = { left: {}, right: {} };
    this.pendingJab = null;
    this.pendingCross = null;
  }

  flush(timestamp, force = false) {
    if (force || (this.pendingCross && timestamp - this.pendingCross.start_ms > 1800)) this.pendingCross = null;
    if (!this.pendingJab) return [];
    const rear = this.stance === 'orthodox' ? 'right' : 'left';
    const rearStart = this.hands[rear].projectedSamples?.[0]?.timestamp ?? this.hands[rear].samples?.[0]?.timestamp;
    const connecting = Number.isFinite(rearStart) && rearStart >= this.pendingJab.start_ms
      && rearStart - this.pendingJab.end_ms <= this.combinationMs && timestamp - rearStart <= 1800;
    if (!force && (timestamp - this.pendingJab.end_ms <= this.combinationMs || connecting)) return [];
    const event = this.pendingJab;
    this.pendingJab = null;
    return [event];
  }

  accept(candidate, hand) {
    const lead = this.stance === 'orthodox' ? 'left' : 'right';
    const label = candidate.label === 'straight' ? hand === lead ? 'jab' : 'cross' : candidate.label;
    const event = { ...candidate, hand, label, id: `motion-${++this.sequence}`, points: Math.max(1, Math.round(candidate.quality / 10)), experimental: true };
    if (label === 'cross') {
      this.pendingCross = event;
      return this.combine();
    }
    const cross = this.pendingCross;
    const output = this.flush(event.end_ms, true);
    if (label === 'jab') {
      this.pendingJab = event;
      this.pendingCross = cross;
      output.push(...this.combine());
    }
    else output.push(event);
    return output;
  }

  combine() {
    const jab = this.pendingJab;
    const cross = this.pendingCross;
    if (!jab || !cross) return [];
    if (cross.start_ms <= jab.start_ms || cross.start_ms - jab.end_ms > this.combinationMs) {
      this.pendingCross = null;
      return [];
    }
    this.pendingJab = null;
    this.pendingCross = null;
    const quality = Math.round((jab.quality + cross.quality) / 2);
    const evidence = {otherGuard:[jab.evidence.otherGuard,cross.evidence.otherGuard].every(Number.isFinite)?(jab.evidence.otherGuard+cross.evidence.otherGuard)/2:null};
    return [{...cross,evidence,label:'one_two',hand:'both',start_ms:jab.start_ms,end_ms:Math.max(jab.end_ms,cross.end_ms),
      confidence:Math.min(jab.confidence,cross.confidence),quality,points:Math.max(1,Math.round(quality/10))*2,components:[jab.id,cross.id]}];
  }

  update(frame) {
    if (!Number.isFinite(frame.timestamp) || frame.timestamp <= this.lastTimestamp) return [];
    const gap = frame.timestamp - this.lastTimestamp;
    this.lastTimestamp = frame.timestamp;
    const output = [];
    if (!frame.valid || gap > 250) {
      output.push(...this.flush(frame.timestamp, true));
      this.invalidate();
    }
    if (!frame.valid) return output;
    for (const hand of ['left', 'right']) {
      const arm = frame.arms?.[hand];
      if (!arm || ![arm.position?.x, arm.position?.y, arm.position?.z, arm.elbowAngle, arm.confidence].every(Number.isFinite) || arm.confidence < 0.65) {
        this.hands[hand] = {};
        continue;
      }
      const state = this.hands[hand];
      const other = frame.arms[hand === 'left' ? 'right' : 'left'];
      const sample = { ...arm, timestamp: frame.timestamp, otherGuard: other ? Boolean(other.guard) : null };
      const projected = this.projectedCandidate(state, sample);
      if (projected) {
        this.hands[hand] = {};
        output.push(...this.accept(projected, hand));
        continue;
      }
      if (!state.baseline) {
        if (!arm.guard) { state.guardSince = null; continue; }
        state.guardSince ??= frame.timestamp;
        if (frame.timestamp - state.guardSince >= 250) {
          state.baseline = { ...arm.position };
          state.previous = sample;
        }
        continue;
      }
      const displacement = distance(arm.position, state.baseline);
      if (!state.samples) {
        if (displacement < 0.35) { state.previous = sample; continue; }
        state.samples = state.previous ? [state.previous, sample] : [sample];
      } else {
        state.samples.push(sample);
        if (frame.timestamp - state.samples[0].timestamp > 1800 || state.samples.length > 100) {
          this.hands[hand] = {};
        } else if (arm.guard && displacement < 0.22 && state.samples.length >= 4) {
          const candidate = classifyTrajectory(state.samples, state.baseline);
          this.hands[hand] = {};
          if (candidate) output.push(...this.accept(candidate, hand));
        }
      }
    }
    output.push(...this.flush(frame.timestamp));
    return output;
  }

  projectedCandidate(state, sample) {
    if (!sample.projected || ![sample.projected.angle, sample.projected.reach].every(Number.isFinite)) {
      state.projectedSamples = null;
      state.projectedBaseline = null;
      return null;
    }
    const retracted = sample.guard && sample.projected.angle <= 120 && sample.projected.reach <= 0.85;
    if (!state.projectedSamples) {
      if (sample.guard && sample.projected.angle <= 100 && sample.projected.reach <= 0.8) state.projectedBaseline = sample;
      else if (state.projectedBaseline && sample.projected.angle >= 120 && sample.projected.reach >= 0.85) state.projectedSamples = [state.projectedBaseline, sample];
      return null;
    }
    const samples = state.projectedSamples;
    samples.push(sample);
    const duration = sample.timestamp - samples[0].timestamp;
    if (duration > 1200 || samples.length > 100) {
      state.projectedSamples = null;
      state.projectedBaseline = null;
      return null;
    }
    if (!retracted) return null;
    state.projectedSamples = null;
    state.projectedBaseline = sample;
    const maximumAngle = Math.max(...samples.map(observation => observation.projected.angle));
    const maximumReach = Math.max(...samples.map(observation => observation.projected.reach));
    const upward = Math.max(...samples.map(observation => samples[0].position.y - observation.position.y));
    if (samples.length < 3 || duration < 80 || maximumAngle < 155 || maximumReach < 0.97 || maximumReach - samples[0].projected.reach < 0.2 || upward >= 0.55) return null;
    const otherGuard = samples.every(observation => typeof observation.otherGuard === 'boolean') ? samples.filter(observation => observation.otherGuard).length / samples.length : null;
    const form = clamp((maximumAngle - 145) / 25);
    return { label:'straight', confidence:Math.min(...samples.map(observation => observation.confidence)),
      quality:Math.round(100 * (0.4 * form + 0.3 * (otherGuard ?? 0) + 0.3)),
      evidence:{source:'projected_extension_recovery',maximumAngle,maximumReach,otherGuard,recovery:1},
      start_ms:samples[0].timestamp,end_ms:sample.timestamp };
  }
}
