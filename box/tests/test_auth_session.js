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
  assert.equal(c.signupBirthdate('2000', '2', '29'), '2000-02-29');
  assert.throws(() => c.signupBirthdate('1900', '2', '29'));
  assert.throws(() => c.signupBirthdate('2001', '2', '29'));
  assert.throws(() => c.signupBirthdate('2000', '4', '31'));
  assert.throws(() => c.signupBirthdate('2000', '0', '10'));
  assert.throws(() => c.signupBirthdate('9999', '1', '1'));
  assert.equal(c.formatSignupPhone('01012345678'), '010-1234-5678');
  assert.equal(c.formatSignupPhone('010 1234 5678'), '010-1234-5678');
  assert.equal(c.formatSignupPhone('0101234567'), '010-123-4567');
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
  const {context:startup,saved:startupSaved} = setup();
  const message = {textContent:'',appendChild:()=>{}};
  startup.$ = () => message;
  startup.document = {createElement:()=>({addEventListener:()=>{}})};
  startup.renderLoggedOut = () => {};
  startup.api = async () => {const error=new Error('Temporary outage');error.status=503;throw error;};
  await startup.hydrate();
  assert.equal(startup.state.token,'old','startup outage preserves saved sign-in');
  assert.equal(startupSaved.length,0);
  startup.api = async () => {const error=new Error('Expired session');error.status=401;throw error;};
  await startup.hydrate();
  assert.equal(startup.state.token,null,'rejected session is cleared');
  console.log('Auth refresh concurrency, late response, and logout tests passed');
  const node = () => ({innerHTML:'',addEventListener(){},querySelectorAll(){return [];},focus(){}});
  const viewHost = node();
  viewHost.innerHTML = 'member list';
  const staffHost = node();
  const nodes = new Map([['#viewContent',viewHost],['#staffAccounts',staffHost]]);
  const staffContext = {state:{user:{id:'owner',role:'CENTER_OWNER'},activeView:'members',accounts:[{id:'coach',username:'coach',name:'Coach',role:'COACH',status:'ACTIVE',staff_note:'<private>'}],platformCenters:[]},
    t:value=>value,roleCanManageAccounts:()=>true,roleLabel:value=>value,escapeHtml:value=>String(value || '').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    $:selector=>{if(!nodes.has(selector)) nodes.set(selector,node());return nodes.get(selector);},document:{querySelectorAll:()=>[]}};
  staffContext.window = staffContext;
  vm.createContext(staffContext);
  vm.runInContext(fs.readFileSync('web/scripts/operations-ui.js','utf8'),staffContext);
  vm.runInContext(fs.readFileSync('web/scripts/accounts.js','utf8'),staffContext);
  staffContext.renderAccounts();
  assert.equal(viewHost.innerHTML,'member list','embedded staff rendering must preserve member table');
  assert.match(staffHost.innerHTML,/직원 관리/);
  assert.match(staffHost.innerHTML,/&lt;private&gt;/);
  assert.doesNotMatch(staffHost.innerHTML,/id="accountCreateForm"/,'registration opens separately');
  const classes = new Set();
  const cards = [{inert:false},{inert:false}];
  const frames = new Map();
  const timers = new Map();
  let handle = 0;
  let clock = 0;
  let removed = 0;
  const panel = {clientWidth:1000,clientHeight:700,prepend(){},classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  const introContext = {window:{},Math,Promise,Uint8Array,performance:{now:()=>clock},matchMedia:()=>({matches:false}),
    requestAnimationFrame:callback=>{frames.set(++handle,callback);return handle;},cancelAnimationFrame:key=>frames.delete(key),
    setTimeout:(callback,delay)=>{timers.set(++handle,{callback,delay});return handle;},clearTimeout:key=>timers.delete(key),
    document:{querySelector:()=>panel,querySelectorAll:()=>cards,createElement:()=>({setAttribute(){},remove(){removed++;},getContext:()=>({fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}})})}};
  vm.createContext(introContext);
  vm.runInContext(fs.readFileSync('web/scripts/login-intro.js','utf8'),introContext);
  const intro = introContext.window.LoginIntro;
  intro.show();
  const advance = time => {clock=time;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(time));};
  advance(6000);
  assert.equal(removed,0,'login background continues beyond five seconds');
  assert.equal(frames.size,1);
  const entering = intro.enter();
  assert.equal(intro.enter(),entering,'duplicate transition shares one completion');
  assert.equal(cards.every(card=>card.inert),true);
  assert.equal(classes.has('login-entering'),true);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay,3000);
  timer.callback();
  assert.equal(await entering,true);
  intro.stop();
  assert.equal(frames.size,0);
  assert.equal(cards.every(card=>!card.inert),true);
  intro.show();
  const cancelled = intro.enter();
  intro.stop();
  assert.equal(await cancelled,false,'logout cancels pending transition');
  introContext.matchMedia=()=>({matches:true});
  intro.show();
  advance(9000);
  assert.equal(frames.size,0,'reduced motion uses static background');
  assert.equal(await intro.enter(),true);
  intro.stop();
})().catch(error=>{console.error(error);process.exitCode=1;});
