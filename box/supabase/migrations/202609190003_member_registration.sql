begin;

create table public.operation_registrations (
  actor_id uuid not null references public.accounts(id),
  request_id text not null,
  center_id uuid not null references public.centers(id),
  actor_version integer not null,
  nonce uuid not null unique,
  input jsonb not null,
  prepared_fields jsonb not null,
  secret_fingerprint text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.operation_registrations enable row level security;
revoke all on public.operation_registrations from public,anon,authenticated;

create function public.operations_registration_prepare(p_input jsonb,p_request_id text,p_secret_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  actor public.accounts%rowtype;
  existing public.operation_registrations%rowtype;
  nonce uuid;
  product public.operation_products%rowtype;
  username text;
  display_name text;
  zone text;
  today date;
  joined date;
  start_day date;
  end_day date;
  profile_patch jsonb;
begin
  actor:=public.operations_actor();
  if actor.role<>'CENTER_OWNER' then raise exception 'center owner required' using errcode='42501'; end if;
  perform 1 from public.accounts where id=actor.id for share;
  actor:=public.operations_actor();
  perform public.operations_text(to_jsonb(p_request_id),'request_id',128);
  if p_secret_fingerprint is null or p_secret_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'invalid credential fingerprint' using errcode='22023'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) key
    where key not in ('username','email','name','phone','birthdate','gender','height_cm','weight_kg','stance','injury_note','training_level','joined_on','product_id','start_on','end_on')) then
    raise exception 'invalid registration input' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||':'||p_request_id,0));
  select * into existing from public.operation_registrations where actor_id=actor.id and request_id=p_request_id for update;
  if found then
    if existing.center_id<>actor.center_id or existing.input<>p_input or existing.secret_fingerprint<>p_secret_fingerprint then
      raise exception 'request_id already used for different registration' using errcode='23505';
    end if;
    if existing.result is not null then return jsonb_build_object('result',existing.result); end if;
    if existing.actor_version<>actor.token_version then raise exception 'registration actor authorization changed' using errcode='42501'; end if;
    update public.account_provisioning set expires_at=now()+interval '10 minutes' where account_provisioning.nonce=existing.nonce;
    return jsonb_build_object('nonce',existing.nonce);
  end if;
  if exists(select 1 from public.operation_requests where actor_id=actor.id and request_id=p_request_id) then
    raise exception 'request_id is already used' using errcode='23505';
  end if;
  username:=lower(public.operations_text(p_input->'username','username',20));
  if username !~ '^[a-z0-9_]{4,20}$' then raise exception 'invalid username' using errcode='22023'; end if;
  display_name:=public.operations_text(p_input->'name','name',100);
  if p_input ? 'email' and (jsonb_typeof(p_input->'email')<>'string' or length(p_input->>'email')>254) then raise exception 'invalid contact email' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_input) field(key,value)
    where (key in ('phone','gender','stance','injury_note') and jsonb_typeof(value)<>'string')
      or (key in ('height_cm','weight_kg','training_level') and (jsonb_typeof(value)<>'number' or value::text !~ '^\d+$'))
      or (key='birthdate' and jsonb_typeof(value) not in ('string','null'))) then
    raise exception 'invalid profile field type' using errcode='22023';
  end if;
  if length(p_input->>'phone')>40 or length(p_input->>'gender')>40 or length(p_input->>'injury_note')>2000 then raise exception 'invalid profile length' using errcode='22023'; end if;
  if nullif(p_input->>'birthdate','') is not null then perform public.operations_day(p_input->>'birthdate'); end if;
  if p_input ? 'height_cm' then perform public.operations_integer(p_input->'height_cm',100,250); end if;
  if p_input ? 'weight_kg' then perform public.operations_integer(p_input->'weight_kg',25,300); end if;
  if p_input ? 'training_level' then perform public.operations_integer(p_input->'training_level',1,5); end if;
  if p_input ? 'stance' and p_input->>'stance' not in ('orthodox','southpaw') then raise exception 'invalid stance' using errcode='22023'; end if;
  select timezone into zone from public.operation_centers where center_id=actor.center_id;
  today:=(now() at time zone coalesce(zone,'Asia/Seoul'))::date;
  joined:=case when nullif(p_input->>'joined_on','') is null then today else public.operations_day(p_input->>'joined_on') end;
  if joined>today then raise exception 'future registration date' using errcode='22023'; end if;
  if nullif(p_input->>'product_id','') is not null then
    select * into product from public.operation_products where id=(p_input->>'product_id')::uuid and center_id=actor.center_id for share;
    if product.id is null then raise exception 'product not found' using errcode='P0002'; end if;
    start_day:=case when nullif(p_input->>'start_on','') is null then joined else public.operations_day(p_input->>'start_on') end;
    end_day:=case when nullif(p_input->>'end_on','') is null then start_day+product.days-1 else public.operations_day(p_input->>'end_on') end;
    if end_day<start_day then raise exception 'invalid pass dates' using errcode='22023'; end if;
  end if;
  nonce:=extensions.gen_random_uuid();
  insert into public.account_provisioning(nonce,username,contact_email,display_name,role,center_id,created_by,creator_token_version)
    values(nonce,username::extensions.citext,coalesce(p_input->>'email',''),display_name,'MEMBER',actor.center_id,actor.id,actor.token_version);
  insert into public.operation_registrations(actor_id,request_id,center_id,actor_version,nonce,input,prepared_fields,secret_fingerprint)
    values(actor.id,p_request_id,actor.center_id,actor.token_version,nonce,p_input,
      jsonb_build_object('joined_on',joined,'start_on',start_day,'end_on',end_day,'remaining',case when product.kind='PERIOD' then null else product.count end),p_secret_fingerprint);
  return jsonb_build_object('nonce',nonce);
end $$;
revoke all on function public.operations_registration_prepare(jsonb,text,text) from public,anon;
grant execute on function public.operations_registration_prepare(jsonb,text,text) to authenticated;

create function public.finish_operational_registration()
returns trigger language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  registration public.operation_registrations%rowtype;
  account public.accounts%rowtype;
  profile public.member_profiles%rowtype;
  product public.operation_products%rowtype;
  pass public.operation_passes%rowtype;
  actor public.accounts%rowtype;
  values jsonb;
  zone text;
  joined date;
  start_day date;
  end_day date;
  registration_result jsonb;
begin
  select * into registration from public.operation_registrations where nonce=nullif(new.raw_user_meta_data->>'provisioning_nonce','')::uuid for update;
  if registration.actor_id is null then return new; end if;
  if registration.result is not null then raise exception 'registration already completed' using errcode='23505'; end if;
  perform public.check_provisioning_actor(registration.actor_id,registration.actor_version,'MEMBER',registration.center_id);
  select * into actor from public.accounts where id=registration.actor_id;
  select * into account from public.accounts where id=new.id and center_id=registration.center_id and role='MEMBER';
  if account.id is null then raise exception 'registration account mismatch' using errcode='42501'; end if;
  values:=registration.input;
  select timezone into zone from public.operation_centers where center_id=registration.center_id;
  joined:=(registration.prepared_fields->>'joined_on')::date;
  update public.member_profiles set name=account.display_name,
    phone=coalesce(values->>'phone',phone),birthdate=nullif(values->>'birthdate','')::date,
    gender=coalesce(values->>'gender',gender),height_cm=coalesce((values->>'height_cm')::integer,height_cm),
    weight_kg=coalesce((values->>'weight_kg')::integer,weight_kg),stance=coalesce(values->>'stance',stance),
    injury_note=coalesce(values->>'injury_note',injury_note),training_level=coalesce((values->>'training_level')::integer,training_level)
    where user_id=new.id and center_id=registration.center_id returning * into profile;
  if profile.id is null then raise exception 'registration profile missing' using errcode='P0002'; end if;
  update public.operation_members set joined_on=joined,version=1 where member_id=new.id;
  if nullif(values->>'product_id','') is not null then
    select * into product from public.operation_products where id=(values->>'product_id')::uuid and center_id=registration.center_id for share;
    if product.id is null then raise exception 'registration product missing' using errcode='P0002'; end if;
    start_day:=(registration.prepared_fields->>'start_on')::date;
    end_day:=(registration.prepared_fields->>'end_on')::date;
    insert into public.operation_passes(id,center_id,member_id,product_id,start_on,end_on,remaining,status)
      values(extensions.gen_random_uuid(),registration.center_id,new.id,product.id,start_day,end_day,(registration.prepared_fields->>'remaining')::integer,'ACTIVE') returning * into pass;
    insert into public.operation_pass_history(id,center_id,pass_id,action,reason,author_id,at,end_on,author_name)
      values(extensions.gen_random_uuid(),registration.center_id,pass.id,'ASSIGN','회원 등록 시 이용권 부여',actor.id,now(),end_day,actor.display_name);
  end if;
  registration_result:=to_jsonb(profile)||jsonb_build_object('id',new.id,'profile_id',profile.id,'joined_on',joined,'version',1,'pass',case when pass.id is null then null else to_jsonb(pass) end);
  update public.operation_registrations set result=registration_result where actor_id=registration.actor_id and request_id=registration.request_id;
  insert into public.operation_audit(id,center_id,actor_id,operation,target_id,before_state,after_state,created_at)
    values(extensions.gen_random_uuid(),registration.center_id,actor.id,'member.create',new.id::text,'{}',registration_result,now());
  insert into public.operation_requests(actor_id,request_id,center_id,fingerprint,result,created_at)
    values(actor.id,registration.request_id,registration.center_id,registration.secret_fingerprint,registration_result,now());
  return new;
end $$;
revoke all on function public.finish_operational_registration() from public,anon,authenticated;
create trigger zz_finish_operational_registration after insert on auth.users for each row execute function public.finish_operational_registration();

commit;
