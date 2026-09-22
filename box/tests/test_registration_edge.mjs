import assert from 'node:assert/strict';
import { registrationHandler } from '../supabase/functions/register-member/handler.mjs';

const input = {username:'testmember',password:'Synthetic!123',password_confirm:'Synthetic!123',name:'Synthetic member'};
function fixture({completed=false,lostResponse=false,denied=false,unfinished=false}={}) {
  let creations=0;
  const calls=[];
  const result={id:'synthetic-member',pass:{id:'synthetic-pass'}};
  const caller={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}}})},rpc:async(name,body)=>{
    calls.push({name,body});
    if(denied) return {error:{code:'42501'}};
    return {data:completed?{result}:{nonce:'synthetic-nonce'}};
  }};
  const admin={auth:{admin:{createUser:async()=>{
    creations++;
    if(!unfinished) completed=true;
    if(lostResponse) throw new Error('Synthetic response loss');
    return {data:{user:{id:result.id}}};
  }}}};
  const handler=registrationHandler({createClient:(_,key)=>key==='public'?caller:admin,
    env:name=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret'})[name]});
  return {handler,calls,creations:()=>creations};
}
const request=()=>new Request('https://synthetic.invalid/register',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({input,request_id:'stable-request'})});
for(const options of [{},{lostResponse:true},{completed:true}]) {
  const test=fixture(options);
  const response=await test.handler(request());
  assert.equal(response.status,200);
  assert.equal((await response.json()).result.pass.id,'synthetic-pass');
  assert.equal(test.creations(),options.completed?0:1);
  assert.ok(test.calls.every(call=>!JSON.stringify(call).includes(input.password)));
  assert.match(test.calls[0].body.p_secret_fingerprint,/^[a-f0-9]{64}$/);
  assert.equal((await test.handler(request())).status,200);
  assert.equal(test.creations(),options.completed?0:1);
}
const denied=fixture({denied:true});
assert.equal((await denied.handler(request())).status,403);
assert.equal(denied.creations(),0);
const unfinished=fixture({unfinished:true});
assert.equal((await unfinished.handler(request())).status,503);
console.log('Registration Edge orchestration: response loss recovery, duplicate suppression, authorization and pending failure passed.');
