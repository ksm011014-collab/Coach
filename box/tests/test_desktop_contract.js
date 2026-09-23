const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function check(platform,allowed) {
  let listener;
  const context={setTimeout,clearTimeout,document:{querySelector:()=>null},window:{crypto:{randomUUID:()=> 'test-id'},chrome:{webview:{
    addEventListener:(type,fn)=>{listener=fn;},
    postMessage:message=>listener({data:{id:message.id,ok:true,payload:platform}})
  }}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/scripts/i18n.js','utf8'),context);
  vm.runInContext(fs.readFileSync('web/scripts/desktop-bridge.js','utf8'),context);
  const result=vm.runInContext('desktopBridge.ensureCompatible()',context);
  if(allowed) await result; else await assert.rejects(result);
}
(async()=>{
  const valid={bridgeProtocol:1,engineVersion:'0.3.0',workerAvailable:true,capabilities:{contract_version:1}};
  await check(valid,true);
  for(const patch of [{workerAvailable:false},{engineVersion:'0.2.0'},{capabilities:null},{bridgeProtocol:2},{capabilities:{contract_version:2}}]) await check({...valid,...patch},false);
  console.log('Desktop worker compatibility allow/deny tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
