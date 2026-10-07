import assert from 'node:assert/strict';
import { classifyTrajectory, PunchRecognizer } from '../web/scripts/motion-recognizer.mjs';

const baseline = { x: 0, y: 0, z: 0 };
const samples = positions => positions.map((position, index) => ({ position: { ...baseline, ...position }, timestamp: index * 80, elbowAngle: position.angle || 100, confidence: 0.9, otherGuard: true }));
const jab = classifyTrajectory(samples([{ z: -0.4 }, { z: -0.8, angle: 165 }, { z: -0.4 }, {}]), baseline);
const hook = classifyTrajectory(samples([{ x: 0.4 }, { x: 0.8 }, { x: 0.4 }, {}]), baseline);
const upper = classifyTrajectory(samples([{ y: -0.4 }, { y: -0.8 }, { y: -0.4 }, {}]), baseline);
assert.equal(jab.label, 'straight');
assert.equal(hook.label, 'hook');
assert.equal(upper.label, 'uppercut');
const contradictory = samples([{ x: 0.4 }, { x: 0.8 }, { x: 0.4 }, {}]);
contradictory[1].projected = {angle:165,reach:0.99};
assert.equal(classifyTrajectory(contradictory,baseline),null);
assert.equal(classifyTrajectory(samples([{ x: 0.05 }, { x: 0.08 }, { x: 0.04 }, {}]), baseline), null);
assert.equal(classifyTrajectory(samples([{ x: 0.4, y: -0.4 }, { x: 0.8, y: -0.8 }, {}, {}]), baseline), null);
const recognizer = new PunchRecognizer();
assert.deepEqual(recognizer.accept(jab, 'left'), []);
const combo = recognizer.accept({ ...jab, start_ms: 200, end_ms: 500 }, 'right');
assert.equal(combo.length, 1);
assert.equal(combo[0].label, 'one_two');
assert.equal(combo[0].components.length, 2);
assert.deepEqual(recognizer.flush(2000), []);
assert.deepEqual(recognizer.accept(jab, 'right'), []);
recognizer.accept(jab, 'left');
assert.equal(recognizer.flush(2000)[0].label, 'jab');
assert.deepEqual(recognizer.flush(3000), []);
const southpaw = new PunchRecognizer({ stance: 'southpaw' });
southpaw.accept(jab, 'right');
assert.equal(southpaw.accept({ ...jab, start_ms: 200, end_ms: 500 }, 'left')[0].label, 'one_two');
const arm = { position: baseline, elbowAngle: 100, confidence: 0.9, guard: true };
recognizer.reset();
for (let timestamp = 0; timestamp <= 1000; timestamp += 50) assert.deepEqual(recognizer.update({ timestamp, valid: true, arms: { left: arm, right: arm } }), []);
recognizer.accept(jab, 'left');
assert.equal(recognizer.update({ timestamp: 1100, valid: false })[0].label, 'jab');
assert.deepEqual(recognizer.flush(3000), []);
assert.deepEqual(recognizer.update({ timestamp: 1000, valid: true, arms: { left: arm, right: arm } }), []);
recognizer.reset();
const emitted = [];
for (let timestamp = 0; timestamp <= 300; timestamp += 50) emitted.push(...recognizer.update({ timestamp, valid: true, arms: { left: arm, right: arm } }));
for (const [timestamp, depth, angle] of [[350, -0.4, 120], [430, -0.8, 165], [510, -0.4, 120], [590, 0, 100]]) {
  emitted.push(...recognizer.update({ timestamp, valid: true, arms: { left: { ...arm, position: { ...baseline, z: depth }, elbowAngle: angle, guard: depth === 0 }, right: arm } }));
}
for (let timestamp = 650; timestamp <= 1800; timestamp += 50) emitted.push(...recognizer.update({ timestamp, valid: true, arms: { left: arm, right: arm } }));
assert.equal(emitted.length, 1);
assert.equal(emitted[0].label, 'jab');
assert.equal(emitted[0].experimental, true);
recognizer.reset();
const sparse = [];
for (let timestamp = 0; timestamp <= 300; timestamp += 100) sparse.push(...recognizer.update({ timestamp, valid: true, arms: { left: arm, right: arm } }));
for (const [timestamp, depth, angle] of [[400, -0.4, 120], [500, -0.8, 165], [600, 0, 100]]) {
  sparse.push(...recognizer.update({ timestamp, valid: true, arms: { left: { ...arm, position: { ...baseline, z: depth }, elbowAngle: angle, guard: depth === 0 }, right: arm } }));
}
sparse.push(...recognizer.flush(1700));
assert.equal(sparse.length, 1);
assert.equal(sparse[0].start_ms, 300);
assert.equal(sparse[0].end_ms, 600);
recognizer.reset();
recognizer.accept(jab, 'left');
recognizer.hands.right.samples = [{timestamp:1000}];
assert.deepEqual(recognizer.flush(1200), []);
const delayedCombo = recognizer.accept({...jab,start_ms:1000,end_ms:1500},'right');
assert.equal(delayedCombo[0].label,'one_two');
recognizer.reset();
recognizer.accept(jab,'left');
recognizer.hands.right.samples = [{timestamp:1000}];
assert.equal(recognizer.flush(2900)[0].label,'jab');
const projectedArm = (angle, reach) => ({...arm, projected:{angle,reach}});
const projectedStroke = (subject, hand, start, angles=[100,160,100], reaches=[0.7,0.99,0.7]) => {
  const events = [];
  for (let index=0;index<angles.length;index++) events.push(...subject.update({timestamp:start+index*100,valid:true,complete:false,arms:{[hand]:projectedArm(angles[index],reaches[index])}}));
  return events;
};
recognizer.reset();
assert.deepEqual(projectedStroke(recognizer,'left',0),[]);
const projectedCombo = projectedStroke(recognizer,'right',300);
assert.equal(projectedCombo.length,1);
assert.equal(projectedCombo[0].label,'one_two');
assert.equal(projectedCombo[0].evidence.otherGuard,null);
assert.deepEqual(recognizer.flush(2000),[]);
for (const [angles,reaches] of [[[100,140,100],[0.7,0.94,0.7]],[[100,160,160],[0.7,0.99,0.99]],[[100,110,100],[0.7,0.8,0.7]]]) {
  recognizer.reset();
  assert.deepEqual(projectedStroke(recognizer,'left',0,angles,reaches),[]);
  assert.deepEqual(recognizer.flush(2000),[]);
}
recognizer.reset();
recognizer.update({timestamp:0,valid:true,arms:{left:projectedArm(100,0.7)}});
recognizer.update({timestamp:100,valid:true,arms:{left:projectedArm(160,0.99)}});
recognizer.update({timestamp:150,valid:false});
recognizer.update({timestamp:200,valid:true,arms:{left:projectedArm(100,0.7)}});
assert.deepEqual(recognizer.flush(2000),[]);
southpaw.reset();
projectedStroke(southpaw,'right',0);
assert.equal(southpaw.flush(2000)[0].label,'jab');
for (const [stance,recoveryOrder] of ['orthodox','southpaw'].flatMap(stance=>['rear-first','together'].map(order=>[stance,order]))) {
  const subject = new PunchRecognizer({stance});
  const lead = stance === 'orthodox' ? 'left' : 'right';
  const rear = lead === 'left' ? 'right' : 'left';
  const compact = projectedArm(100,0.7);
  const extended = {...projectedArm(160,0.99),guard:false};
  const events = [];
  for (const [timestamp,leadArm,rearArm] of [[0,compact,compact],[100,extended,compact],[200,extended,extended],[300,recoveryOrder==='together'?compact:extended,compact],[400,compact,compact]]) {
    events.push(...subject.update({timestamp,valid:true,arms:{[lead]:leadArm,[rear]:rearArm}}));
  }
  events.push(...subject.flush(2400,true));
  assert.deepEqual(events.map(event=>event.label),['one_two'],`${stance}: ${recoveryOrder} recovery`);
  assert.equal(events[0].start_ms,0);
  assert.equal(events[0].end_ms,recoveryOrder==='together'?300:400);
  assert.equal(new Set(events[0].components).size,2);
}
for (const resetMode of ['invalid','gap','finish']) {
  const subject = new PunchRecognizer();
  subject.accept({...jab,start_ms:200,end_ms:400},'right');
  if (resetMode === 'invalid') subject.update({timestamp:450,valid:false});
  if (resetMode === 'gap') {
    subject.lastTimestamp = 400;
    subject.update({timestamp:700,valid:true,arms:{left:arm,right:arm}});
  }
  if (resetMode === 'finish') subject.flush(450,true);
  assert.deepEqual(subject.accept({...jab,start_ms:100,end_ms:800},'left'),[]);
  assert.equal(subject.flush(2000,true)[0].label,'jab');
}
recognizer.reset();
recognizer.accept({...jab,start_ms:0,end_ms:300},'right');
assert.deepEqual(recognizer.accept({...jab,start_ms:400,end_ms:700},'left'),[]);
assert.equal(recognizer.flush(2000,true)[0].label,'jab');
console.log('Experimental motion rules: synthetic trajectories, ambiguity, stance, one-two deduplication, idle and tracking loss passed; not real-world accuracy.');
