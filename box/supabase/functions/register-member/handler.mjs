const respond = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8'}});

export function registrationHandler({ createClient, env }) {
  return async request => {
    if (request.method !== 'POST') return respond({error:'POST 요청만 허용됩니다.'},405);
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return respond({error:'로그인이 필요합니다.'},401);
    const url = env('SUPABASE_URL');
    const publicKey = env('SUPABASE_ANON_KEY');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !publicKey || !serviceKey) return respond({error:'서버 계정 설정이 필요합니다.'},503);
    let body;
    try { body = await request.json(); } catch { return respond({error:'올바른 JSON 요청이 필요합니다.'},400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.input || typeof body.input !== 'object' || Array.isArray(body.input) || typeof body.request_id !== 'string' || !body.request_id.trim() || body.request_id.length > 128) return respond({error:'등록 요청 형식이 올바르지 않습니다.'},400);
    const {password, password_confirm, ...input} = body.input;
    if (typeof password !== 'string' || password !== password_confirm || password.length < 8 || password.length > 256 || !/[^A-Za-z0-9]/.test(password)) return respond({error:'비밀번호는 특수문자를 포함한 8~256자이며 확인 값과 일치해야 합니다.'},400);
    if (typeof input.username !== 'string' || !/^[a-z0-9_]{4,20}$/.test(input.username.trim().toLowerCase())) return respond({error:'로그인 아이디 형식이 올바르지 않습니다.'},400);
    input.username = input.username.trim().toLowerCase();
    const caller = createClient(url,publicKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    try {
      const {data:identity,error:identityError} = await caller.auth.getUser();
      if (identityError || !identity?.user) return respond({error:'로그인 세션이 유효하지 않습니다.'},401);
      const encoder = new TextEncoder();
      const hmacKey = await crypto.subtle.importKey('raw',encoder.encode(serviceKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const digest = await crypto.subtle.sign('HMAC',hmacKey,encoder.encode(JSON.stringify([identity.user.id,body.request_id,password])));
      const fingerprint = Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      const prepare = () => caller.rpc('operations_registration_prepare',{p_input:input,p_request_id:body.request_id,p_secret_fingerprint:fingerprint});
      const prepared = await prepare();
      if (prepared.error) return respond({error:'등록 정보를 확인하세요. 권한 변경 또는 동일 요청의 입력 충돌일 수 있습니다.'},prepared.error.code==='42501'?403:prepared.error.code==='23505'?409:400);
      if (prepared.data?.result) return respond({result:prepared.data.result});
      if (!prepared.data?.nonce) return respond({error:'등록 준비 응답을 확인할 수 없습니다. 같은 요청으로 재시도하세요.'},503);
      const domain = env('BOXING_COACH_AUTH_EMAIL_DOMAIN') || 'accounts.boxingcoach.app';
      if (!/^[a-z0-9.-]+$/i.test(domain)) return respond({error:'서버 인증 도메인 설정을 확인하세요.'},503);
      let creationError;
      try {
        const creation = await admin.auth.admin.createUser({email:`${input.username}@${domain}`,password,email_confirm:true,
          user_metadata:{username:input.username,name:input.name,contact_email:input.email || '',provisioning_nonce:prepared.data.nonce}});
        creationError = creation.error;
      } catch (error) { creationError = error; }
      const recovered = await prepare();
      if (!recovered.error && recovered.data?.result) return respond({result:recovered.data.result});
      return respond({error:creationError ? '회원 등록이 완료됐는지 확인하지 못했습니다. 같은 입력으로 재시도하세요.' : '등록 결과 조회에 실패했습니다. 다시 생성하지 말고 같은 요청으로 재시도하세요.'},503);
    } catch {
      return respond({error:'등록 서비스에 연결할 수 없습니다. 같은 입력으로 재시도하세요.'},503);
    }
  };
}
