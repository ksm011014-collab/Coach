const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture({analysisError=false,recordingError=false,retry=false}={}) {
  const calls=[];
  const elements={};
  let finishes=0;
  const state={activeSessionId:'round',activeSessionStartedAt:1,sessionBusy:false,sessions:[{id:'round'}],localRecordings:{},pendingSessionEnd:null,motionReportVersions:[1]};
  const context=vm.createContext({state,window:{MotionSession:{finishRound:()=>{finishes++;if(analysisError) throw new Error('analysis');return {version:1,duration_ms:500};}},RoundCoach:{show:(session,options)=>calls.push({popup:options.endReason})}},
    Date:{now:()=>2000},$:selector=>elements[selector]||=( {} ),clearTimeout:()=>{},clearInterval:()=>{},
    setTimeout:callback=>{context.timerCallback=callback;return 1;},sessionDurationSecondsFromCenter:()=>1});
  vm.runInContext(fs.readFileSync('web/scripts/i18n.js','utf8'),context);
  vm.runInContext(fs.readFileSync('web/scripts/session.js','utf8'),context);
  context.updateSessionControls=()=>{};
  context.stopCamera=()=>calls.push({cameraStopped:true});
  context.stopRecording=async()=>{if(recordingError) throw new Error('recording');return {size:123};};
  context.notifyUser=()=>{};context.playTone=()=>{};
  context.api=async(route,options)=>{calls.push({body:options.body});if(retry){retry=false;throw new Error('lost response');}return {session:{id:'round',ended_at:2}};};
  return {context,state,calls,elements,finishes:()=>finishes};
}

(async()=>{
  const retried=fixture({retry:true});
  await retried.context.stopSession('timer');
  assert.equal(retried.state.pendingSessionEnd.reason,'timer');
  const snapshot=retried.state.pendingSessionEnd.body;
  retried.context.Date.now=()=>20000;
  assert.equal(retried.context.sessionTimerText(),'00:01 / 00:01');
  await retried.context.stopSession();
  assert.equal(retried.finishes(),1);
  assert.deepEqual(retried.calls.filter(call=>call.body).map(call=>JSON.parse(call.body)),[JSON.parse(JSON.stringify(snapshot)),JSON.parse(JSON.stringify(snapshot))]);
  assert.equal(retried.calls.find(call=>call.popup).popup,'timer');
  assert.equal(retried.state.activeSessionId,'');
  assert.equal(retried.state.pendingSessionEnd,null);
  for(const options of [{analysisError:true},{recordingError:true},{analysisError:true,recordingError:true}]) {
    const failed=fixture(options);
    await failed.context.stopSession();
    assert.equal(failed.state.activeSessionId,'');
    assert.equal(failed.calls.find(call=>call.popup).popup,'manual');
    assert.ok(failed.calls.some(call=>call.cameraStopped));
    if(options.analysisError) assert.match(failed.elements['#sessionMessage'].textContent,/동작 분석 결과는 저장하지 못했습니다/);
  }
  const automatic=fixture();
  const legacy=fixture();
  legacy.state.motionReportVersions=[];
  await legacy.context.stopSession();
  assert.equal(legacy.calls.find(call=>call.body).body,'{}');
  assert.match(legacy.elements['#sessionMessage'].textContent,/동작 분석 결과는 저장하지 못했습니다/);
  automatic.context.startRoundTimer();
  automatic.context.timerCallback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(automatic.calls.find(call=>call.popup).popup,'timer');
  console.log('Session finish: analysis/recording failure isolation, frozen retry, stopped timer and automatic/manual distinction passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
