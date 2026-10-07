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
const {createNativeVoice, loadVoiceSettings} = await import('../web/scripts/coach-native-voice.mjs');
assert.equal(loadVoiceSettings({getItem:()=>'{broken'}).enabled, true);
assert.deepEqual(loadVoiceSettings({getItem:()=>'{"enabled":false,"autoRead":false,"volume":99,"rate":-1}'}), {enabled:false,autoRead:false,volume:1,rate:0.5});
let completeSynthesis;
let audioCreations = 0;
globalThis.Audio = class { constructor() { audioCreations++; } };
const nativeProvider = await createNativeVoice({request: async type => {
  if (type === 'speech.voices') return [{language:'ko-KR'}];
  if (type === 'speech.synthesize') return new Promise(resolve => { completeSynthesis=resolve; });
  return {stopped:true};
}}, {enabled:true,volume:1,rate:1});
const nativeController = new AbortController();
const pendingNative = nativeProvider.speak({text:'안녕하세요.',language:'ko',signal:nativeController.signal,onStart:()=>{}});
nativeProvider.stop();
completeSynthesis({contentType:'audio/wav',audio:''});
await pendingNative;
assert.equal(audioCreations,0,'stopped synthesis must not start delayed playback');
await assert.rejects(nativeProvider.speak({text:'Hello.',language:'en',signal:new AbortController().signal,onStart:()=>{}}), /speech_voice_missing/);
let closedAudioContexts = 0;
const measuredLevels = [];
globalThis.requestAnimationFrame = callback => setTimeout(callback, 1);
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
globalThis.AudioContext = class {
  destination = {};
  createAnalyser() { return {fftSize:256,connect(){},getByteTimeDomainData(samples){samples.fill(160);}}; }
  createMediaElementSource() { return {connect(){}}; }
  async resume() {}
  async close() { closedAudioContexts++; }
};
globalThis.Audio = class {
  async play() { this.onplaying?.(); setTimeout(()=>this.onended?.(), 15); }
  pause() {}
  removeAttribute() {}
  load() {}
};
const measuredProvider = await createNativeVoice({request:async type => type === 'speech.voices' ? [{language:'en-US'}] : {contentType:'audio/wav',audio:''}}, {enabled:true,volume:1,rate:1});
await measuredProvider.speak({text:'Hello.',language:'en',signal:new AbortController().signal,onStart:()=>{},onLevel:level=>measuredLevels.push(level)});
assert.ok(measuredLevels.some(level=>level>0),'speaker animation receives measured audio energy');
assert.equal(measuredLevels.at(-1),0);
assert.equal(closedAudioContexts,1,'audio analysis is released after playback');
delete globalThis.Audio;
delete globalThis.AudioContext;
delete globalThis.requestAnimationFrame;
delete globalThis.cancelAnimationFrame;
const {withLocalInput} = await import('../web/scripts/coach-local-input.mjs');
let finishPermission;
let releasedTracks=0;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{finishPermission=resolve;})}}});
globalThis.MediaRecorder=class {};
const localInput=withLocalInput(null,()=>{throw new Error('Cancelled capture must not upload audio');});
const inputController=new AbortController();
const delayedInput=localInput.listen({language:'ko',signal:inputController.signal,onStart:()=>{throw new Error('Cancelled input must not start');}});
inputController.abort();
finishPermission({getTracks:()=>[{stop:()=>releasedTracks++}]});
await assert.rejects(delayedInput,{name:'AbortError'});
assert.ok(releasedTracks>0,'permission granted after cancellation still releases the microphone');
delete globalThis.MediaRecorder;
delete globalThis.navigator;
