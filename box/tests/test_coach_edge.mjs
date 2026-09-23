import assert from 'node:assert/strict';
import {coachHandler} from '../supabase/functions/coach-chat/handler.mjs';

const id='00000000-0000-4000-8000-000000000013';
const requestBody={action:'reply',session_id:'00000000-0000-4000-8000-000000000801',request_id:'00000000-0000-4000-8000-000000000810',model:'test-model',language:'en',question:'How can I improve?',history:[],summary:{total_points:999999}};
const completeResponse={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Try a controlled drill.'}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}};
function fixture({payload=completeResponse,providerStatus=200,failUsage=false,missingKey=false,prepareError=null,role='MEMBER',timeout=false}={}) {
  const reservations=new Set(), writes=[], calls=[];
  const caller={auth:{getUser:async()=>({data:{user:{id}}})},
    from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{model_id:'test-model',display_name:'Test model',is_default:true}]})})})}),
    rpc:async(name,args)=>{
      if(name==='current_account_role') return {data:role};
      if(name==='coach_prepare') {
        if(prepareError) return {error:{code:prepareError}};
        if(reservations.has(args.p_request_id)) return {data:{duplicate:true}};
        reservations.add(args.p_request_id);
        return {data:{actor_id:id,session:{started_at:100,ended_at:110,feedback_report:{version:1,status:'unavailable'}}}};
      }
      throw new Error('Unexpected caller RPC');
    }};
  const admin={rpc:async(name,args)=>{assert.equal(name,'coach_complete');writes.push(args);return failUsage?{error:{code:'offline'}}:{};}};
  const handler=coachHandler({createClient:(url,key)=>key==='service'?admin:caller,
    env:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service',OPENAI_API_KEY:missingKey?'':'secret'})[name],
    timeoutMs:10,fetchImpl:async(url,options)=>{
      calls.push({url,options,body:JSON.parse(options.body)});
      if(timeout) return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}));
      return new Response(JSON.stringify(payload),{status:providerStatus});
    }});
  const send=(body=requestBody,auth='Bearer test')=>handler(new Request('https://test.invalid/coach-chat',{method:'POST',headers:{Authorization:auth},body:JSON.stringify(body)}));
  return {send,calls,writes};
}
const normal=fixture();
const response=await normal.send();
assert.equal(response.status,200);
assert.deepEqual((await response.json()).usage,completeResponse.usage);
assert.equal(normal.calls[0].url,'https://api.openai.com/v1/responses');
assert.equal(normal.calls[0].body.store,false);
assert.match(normal.calls[0].body.instructions,/English/);
assert.match(normal.calls[0].body.instructions,/duration_seconds":10/);
assert.doesNotMatch(normal.calls[0].body.instructions,/999999|session_id|user_id/);
assert.equal(normal.writes[0].p_total,120);
assert.equal(normal.writes[0].p_status,'completed');
assert.equal((await normal.send()).status,409);
assert.equal(normal.calls.length,1);
const korean=fixture();
await korean.send({...requestBody,language:'ko'});
assert.match(korean.calls[0].body.instructions,/Korean/);
const unknown=fixture({payload:{...completeResponse,usage:undefined}});
assert.equal((await unknown.send()).status,200);
assert.equal(unknown.writes[0].p_input,null);
assert.equal(unknown.writes[0].p_output,null);
const badTokens=fixture({payload:{...completeResponse,usage:{input_tokens:-1,output_tokens:'5',total_tokens:1.5}}});
await badTokens.send();
assert.equal(badTokens.writes[0].p_total,null);
const timed=fixture({timeout:true});
assert.equal((await timed.send()).status,504);
assert.equal(timed.writes[0].p_status,'unknown');
assert.equal((await timed.send()).status,409);
assert.equal(timed.calls.length,1);
const incomplete=fixture({payload:{...completeResponse,status:'incomplete'}});
assert.equal((await incomplete.send()).status,502);
assert.equal(incomplete.writes[0].p_total,120);
const unavailable=fixture({missingKey:true});
assert.equal((await unavailable.send()).status,503);
assert.equal((await (await unavailable.send({action:'config'})).json()).available,false);
assert.equal((await (await fixture({role:'PLATFORM_ADMIN'}).send({action:'config'})).json()).available,false);
for(const [code,status] of [['42501',403],['23505',409],['P0001',429]]) {
  const denied=fixture({prepareError:code});
  assert.equal((await denied.send()).status,status);
  assert.equal(denied.calls.length,0);
}
assert.equal((await fixture().send(requestBody,'')).status,401);
assert.equal((await fixture().send({...requestBody,question:'x'.repeat(2001)})).status,400);
assert.equal((await fixture().send({...requestBody,question:'x'.repeat(33000)})).status,413);
const writeFailure=await fixture({failUsage:true}).send();
assert.equal((await writeFailure.json()).usage_recorded,false);
console.log('Coach Edge: authoritative summary, language, real usage/null, limits, duplicate reservation, timeout, failures and configuration passed (mock provider).');
