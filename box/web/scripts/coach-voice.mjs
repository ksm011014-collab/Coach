export class CoachVoice {
  constructor({provider,language='ko',onState=()=>{},onLevel=()=>{},onTranscript=()=>{},inputTimeoutMs=30000,outputTimeoutMs=120000}) {
    this.provider=provider;
    this.language=language==='en'?'en':'ko';
    this.onState=onState;
    this.onLevel=onLevel;
    this.onTranscript=onTranscript;
    this.inputTimeoutMs=inputTimeoutMs;
    this.outputTimeoutMs=outputTimeoutMs;
    this.active=null;
    this.closed=false;
  }

  supports(kind) { return typeof this.provider?.[kind]==='function' && typeof this.provider?.stop==='function'; }

  stop() {
    const active=this.active;
    this.active=null;
    active?.controller.abort();
    clearTimeout(this.levelTimer);
    if (active) { try { this.provider.stop(); } catch (_) {} }
    this.onLevel(0);
    if (!this.closed) this.onState('idle');
  }

  close() { this.closed=true; this.stop(); }

  async run(kind,text) {
    if (this.closed || !this.supports(kind)) return false;
    if (kind==='speak' && (typeof text!=='string' || !text.trim() || text.length>16000)) return false;
    this.stop();
    const active={controller:new AbortController(),started:false};
    this.active=active;
    const current=()=>!this.closed && this.active===active;
    this.onState(kind==='listen'?'preparing-input':'preparing-output');
    let timer;
    try {
      const request={language:this.language,signal:active.controller.signal,onStart:()=>{
        if (!current()) return;
        active.started=true;
        this.onState(kind==='listen'?'listening':'playing');
      },onLevel:level=>{
        if (!current() || kind!=='speak' || !active.started || !Number.isFinite(level)) return;
        clearTimeout(this.levelTimer);
        this.onLevel(Math.max(0,Math.min(1,level)));
        this.levelTimer=setTimeout(()=>{if(current()) this.onLevel(0);},150);
      }};
      if (kind==='speak') request.text=text;
      const cancelled=new Promise((_,reject)=>active.controller.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
      timer=setTimeout(()=>active.controller.abort(),kind==='listen'?this.inputTimeoutMs:this.outputTimeoutMs);
      const result=await Promise.race([Promise.resolve().then(()=>current()?this.provider[kind](request):null),cancelled]);
      if (!current()) return false;
      if (kind==='listen') {
        if (typeof result?.text!=='string' || !result.text.trim() || result.text.length>2000) throw new Error('empty_transcript');
        this.onTranscript(result.text.trim());
      }
      this.stop();
      return true;
    } catch (error) {
      if (current()) {
        const reason=active.controller.signal.aborted?'timeout':error.name==='NotAllowedError'?'denied':'error';
        this.stop();
        this.onState(reason);
      }
      return false;
    } finally { clearTimeout(timer); }
  }

  listen() { return this.run('listen'); }
  speak(text) { return this.run('speak',text); }
}
