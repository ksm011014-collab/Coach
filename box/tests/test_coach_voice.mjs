import assert from 'node:assert/strict';
import {CoachVoice} from '../web/scripts/coach-voice.mjs';

let listening;
let playback;
let finishInput;
let finishOutput;
let stops=0;
const states=[];
const levels=[];
const transcripts=[];
const voice=new CoachVoice({provider:{
  stop:()=>stops++,
  listen:request=>{listening=request;return new Promise(resolve=>{finishInput=resolve;});},
  speak:request=>{playback=request;return new Promise(resolve=>{finishOutput=resolve;});},
},onState:state=>states.push(state),onLevel:level=>levels.push(level),onTranscript:text=>transcripts.push(text)});
assert.equal(stops,0);
const input=voice.listen();
await Promise.resolve();
assert.equal(states.at(-1),'preparing-input');
listening.onStart();
assert.equal(states.at(-1),'listening');
const speech=voice.speak('합성 음성 테스트');
await Promise.resolve();
assert.equal(listening.signal.aborted,true);
assert.equal(stops,1);
finishInput({text:'취소 후 늦은 입력'});
assert.equal(await input,false);
assert.deepEqual(transcripts,[]);
playback.onLevel(0.9);
assert.equal(levels.at(-1),0);
playback.onStart();
playback.onLevel(0.4);
assert.equal(levels.at(-1),0.4);
voice.close();
assert.equal(playback.signal.aborted,true);
assert.equal(levels.at(-1),0);
playback.onLevel(1);
assert.equal(levels.at(-1),0);
finishOutput();
assert.equal(await speech,false);
assert.equal(await voice.listen(),false);
const deniedStates=[];
const denied=new CoachVoice({provider:{stop:()=>{},listen:()=>Promise.reject(Object.assign(new Error('permission'),{name:'NotAllowedError'}))},onState:state=>deniedStates.push(state)});
assert.equal(await denied.listen(),false);
assert.equal(deniedStates.at(-1),'denied');
const timedStates=[];
let timedStopped=false;
const timed=new CoachVoice({inputTimeoutMs:5,provider:{stop:()=>{timedStopped=true;},listen:()=>new Promise(()=>{})},onState:state=>timedStates.push(state)});
assert.equal(await timed.listen(),false);
assert.equal(timedStopped,true);
assert.equal(timedStates.at(-1),'timeout');
const successful=new CoachVoice({provider:{stop:()=>{},listen:async()=>({text:'  확인 후 전송  '})},onTranscript:text=>transcripts.push(text)});
assert.equal(await successful.listen(),true);
assert.deepEqual(transcripts,['확인 후 전송']);
assert.equal(new CoachVoice({}).supports('listen'),false);
console.log('Voice contract: explicit input, permission failure, playback/input exclusion, timeout, stop and stale amplitude/transcript rejection passed');
