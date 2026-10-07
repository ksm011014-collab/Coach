import fs from 'node:fs';
import path from 'node:path';
import {poseFeatures as currentFeatures} from '../web/scripts/motion-features.mjs';
import {PunchRecognizer as CurrentRecognizer} from '../web/scripts/motion-recognizer.mjs';
import {execFileSync} from 'node:child_process';
import {MotionRound} from '../web/scripts/motion-round.mjs';

const [inputPath,outputPath,strideArgument='1',widthArgument,heightArgument,baselineRef]=process.argv.slice(2);
const width=Number(widthArgument);
const height=Number(heightArgument);
if ((widthArgument || heightArgument) && (!Number.isFinite(width) || width<=0 || !Number.isFinite(height) || height<=0)) throw new Error('Provide both verified source width and height for older diagnostics');
const stride=Number(strideArgument);
if (!inputPath || !outputPath || !Number.isSafeInteger(stride) || stride<1) throw new Error('Usage: node tools/replay_motion_poses.mjs input.json output.json [stride]');
if (fs.existsSync(outputPath)) throw new Error('Output exists; select a new path');
const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
if (!Array.isArray(input.pose_frames) || !input.pose_frames.length || !Number.isFinite(input.duration_ms)) throw new Error('Pose diagnostics and duration required');
let poseFeatures=currentFeatures;
let Recognizer=CurrentRecognizer;
let sourceRef='working-tree';
if (baselineRef) {
  if (!/^[a-f0-9]{7,40}$/.test(baselineRef)) throw new Error('Baseline must be a verified Git commit hash');
  sourceRef=execFileSync('git',['rev-parse',`${baselineRef}^{commit}`],{encoding:'utf8'}).trim();
  const load=async filename=>{
    const source=execFileSync('git',['show',`${sourceRef}:box/web/scripts/${filename}`]);
    return import(`data:text/javascript;base64,${source.toString('base64')}`);
  };
  poseFeatures=(await load('motion-features.mjs')).poseFeatures;
  Recognizer=(await load('motion-recognizer.mjs')).PunchRecognizer;
}
const round=new MotionRound({startedAt:0,stance:input.stance,recognizer:new Recognizer({stance:input.stance})});
const reasons={};
let frames=0;
let valid=0;
let complete=0;
let previous=-Infinity;
for (let index=0;index<input.pose_frames.length;index+=stride) {
  const observation=input.pose_frames[index];
  if (!Number.isFinite(observation.timestamp) || observation.timestamp<=previous || observation.timestamp>input.duration_ms) throw new Error('Invalid frame timestamps');
  previous=observation.timestamp;
  const features=poseFeatures({...observation,width:observation.width||width,height:observation.height||height});
  frames++;
  if (features.valid) { valid++; if(features.complete!==false) complete++; } else reasons[features.reason]=(reasons[features.reason]||0)+1;
  round.update(features);
}
const report=round.finish(input.duration_ms);
const result={clip_id:input.clip_id,input_sha256:input.input_sha256,duration_ms:input.duration_ms,stance:input.stance,
  workload:'recorded pose replay; no new inference or camera measurement',source_ref:sourceRef,stride,frames,valid_pose_frames:valid,complete_pose_frames:complete,
  invalid_reason_counts:reasons,events:report.events,tracking:report.tracking};
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({clip_id:result.clip_id,stride,frames,valid_pose_frames:valid,events:report.events.length}));
