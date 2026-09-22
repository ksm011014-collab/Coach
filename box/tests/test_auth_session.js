const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/scripts/auth-shell.js', 'utf8');
function setup() {
  const saved = [];
  const context = {state:{token:'old',refreshToken:'refresh-old'}, Date, console, window:{},
    authSessionStorage:{save:async value=>saved.push(value),clear:async()=>saved.push(null)}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/scripts/i18n.js', 'utf8'), context);
  vm.runInContext(source,context);
  return {context,saved};
}
const response = (status,body={}) => ({status,ok:status>=200&&status<300,json:async()=>body});
(async()=>{
  const {context:c,saved} = setup();
  let refreshes=0;
  c.fetch=async()=>{refreshes++; await new Promise(resolve=>setImmediate(resolve)); return response(200,{token:'new',refresh_token:'refresh-new'});};
  c.platformApiFetch=async(path,options)=>response(options.headers.Authorization==='Bearer new'?200:401,{value:1});
  const results=await Promise.all([c.api('/me'),c.api('/sessions')]);
  assert.equal(results.length,2);
  assert.equal(refreshes,1,'concurrent expired requests share one refresh');
  assert.equal(saved.length,1);
  assert.equal(c.state.token,'new');
  // A late old-token 401 must use the already refreshed token, not rotate again.
  let finishOld;
  c.state.token='old';
  c.platformApiFetch=async(path,options)=>{
    if(path==='/slow'&&options.headers.Authorization==='Bearer old') return new Promise(resolve=>{finishOld=()=>resolve(response(401));});
    return response(options.headers.Authorization==='Bearer new'?200:401);
  };
  const slow=c.api('/slow');
  await c.api('/fast');
  finishOld(); await slow;
  assert.equal(refreshes,2);

  const {context:late} = setup();
  let finishRefresh;
  late.fetch=()=>new Promise(resolve=>{finishRefresh=()=>resolve(response(200,{token:'late',refresh_token:'late-refresh'}));});
  const pending=late.refreshAuthSession();
  await late.clearAuthSession();
  finishRefresh();
  await assert.rejects(pending,/로그인 상태가 변경/);
  assert.equal(late.state.token,null,'late refresh cannot restore a cleared login');

  const {context:offline} = setup();
  offline.fetch=async()=>response(503);
  await assert.rejects(offline.refreshAuthSession());
  assert.equal(offline.state.refreshToken,'refresh-old','temporary server failure preserves retry credentials');
  offline.platformApiFetch=async()=>response(503);
  await assert.rejects(offline.logoutAuthSession());
  assert.equal(offline.state.token,'old','remote logout failure remains retryable');
  offline.platformApiFetch=async(path)=>{assert.equal(path,'/auth/logout');return response(200,{logged_out:true});};
  await offline.logoutAuthSession();
  assert.equal(offline.state.token,null);
  console.log('Auth refresh concurrency, late response, and logout tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
