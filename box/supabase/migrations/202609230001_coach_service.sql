begin;

-- No provider key or conversation text is stored in these tables.
create table public.coach_models (
  model_id text primary key check (model_id ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  display_name text not null check (length(display_name) between 1 and 100),
  enabled boolean not null default true,
  is_default boolean not null default false,
  check (not is_default or enabled)
);
create unique index coach_models_one_default on public.coach_models(is_default) where is_default;
alter table public.coach_models enable row level security;
create policy coach_models_read on public.coach_models for select to authenticated
  using (public.account_is_active() and (enabled or public.current_account_role()='PLATFORM_ADMIN'));
revoke all on public.coach_models from public, anon, authenticated;
grant select on public.coach_models to authenticated;

create table public.coach_requests (
  actor_id uuid not null references public.accounts(id) on delete restrict,
  request_id uuid not null,
  center_id uuid not null references public.centers(id) on delete restrict,
  session_id uuid references public.training_sessions(id) on delete set null,
  model_id text not null references public.coach_models(model_id) on delete restrict,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','completed','failed','unknown')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  input_tokens bigint check (input_tokens>=0),
  output_tokens bigint check (output_tokens>=0),
  total_tokens bigint check (total_tokens>=0),
  primary key(actor_id,request_id)
);
create index coach_requests_center_time on public.coach_requests(center_id,created_at);
create index coach_requests_actor_time on public.coach_requests(actor_id,created_at);
alter table public.coach_requests enable row level security;
create policy coach_requests_read on public.coach_requests for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role()='PLATFORM_ADMIN' or
    (center_id=public.current_center_id() and (
      public.current_account_role() in ('CENTER_OWNER','COACH') or actor_id=auth.uid()
    ))
  )
);
revoke all on public.coach_requests from public,anon,authenticated;
-- The digest and session references are not needed for usage views.
grant select(actor_id,center_id,model_id,status,created_at,input_tokens,output_tokens,total_tokens)
  on public.coach_requests to authenticated;

create function public.platform_set_coach_model(p_model_id text,p_display_name text,p_enabled boolean,p_default boolean)
returns void language plpgsql security definer set search_path=public,auth as $$
declare actor public.accounts;
begin
  actor := public.require_platform_admin();
  perform pg_advisory_xact_lock(hashtextextended('coach-model-config',0));
  if p_default then update public.coach_models set is_default=false where is_default; end if;
  insert into public.coach_models values(p_model_id,p_display_name,p_enabled,p_default)
    on conflict(model_id) do update set display_name=excluded.display_name,enabled=excluded.enabled,is_default=excluded.is_default;
  insert into public.audit_logs(actor_id,target_type,target_id,action,after_state)
    values(actor.id,'COACH_MODEL',p_model_id,'CONFIGURE',jsonb_build_object('enabled',p_enabled,'default',p_default));
end $$;

create function public.coach_prepare(p_request_id uuid,p_session_id uuid,p_model_id text,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor public.accounts; workout public.training_sessions; previous public.coach_requests;
begin
  select * into actor from public.accounts where id=auth.uid() and public.account_is_active();
  if actor.id is null or actor.role not in ('CENTER_OWNER','COACH','MEMBER') then
    raise exception 'coach access denied' using errcode='42501';
  end if;
  select * into workout from public.training_sessions where id=p_session_id
    and center_id=actor.center_id and (actor.role in ('CENTER_OWNER','COACH') or user_id=actor.id);
  if workout.id is null then raise exception 'session access denied' using errcode='42501'; end if;
  if workout.ended_at is null then raise exception 'round must be finished' using errcode='22023'; end if;
  -- Serializes reservations across Edge instances, including per-center limits.
  perform pg_advisory_xact_lock(hashtextextended('coach:'||actor.center_id::text,0));
  select * into previous from public.coach_requests where actor_id=actor.id and request_id=p_request_id;
  if previous.request_id is not null then
    if previous.session_id is distinct from p_session_id or previous.model_id<>p_model_id or previous.fingerprint<>p_fingerprint then
      raise exception 'request conflict' using errcode='23505';
    end if;
    return jsonb_build_object('duplicate',true,'status',previous.status);
  end if;
  if not exists(select 1 from public.coach_models where model_id=p_model_id and enabled) then
    raise exception 'model not allowed' using errcode='42501';
  end if;
  if (select count(*) from public.coach_requests where actor_id=actor.id and created_at>now()-interval '1 minute')>=6
    or (select count(*) from public.coach_requests where actor_id=actor.id and created_at>now()-interval '24 hours')>=60
    or (select count(*) from public.coach_requests where center_id=actor.center_id and created_at>now()-interval '24 hours')>=1000 then
    raise exception 'coach rate limit' using errcode='P0001';
  end if;
  insert into public.coach_requests(actor_id,request_id,center_id,session_id,model_id,fingerprint)
    values(actor.id,p_request_id,actor.center_id,workout.id,p_model_id,p_fingerprint);
  return jsonb_build_object('duplicate',false,'actor_id',actor.id,'session',jsonb_build_object(
    'started_at',extract(epoch from workout.started_at),'ended_at',extract(epoch from workout.ended_at),
    'feedback_report',workout.feedback_report));
end $$;

-- Only the Edge service identity can record provider usage; clients cannot mint usage.
create function public.coach_complete(p_actor_id uuid,p_request_id uuid,p_status text,p_input bigint,p_output bigint,p_total bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('completed','failed','unknown') then raise exception 'invalid status'; end if;
  update public.coach_requests set status=p_status,completed_at=now(),input_tokens=p_input,output_tokens=p_output,total_tokens=p_total
    where actor_id=p_actor_id and request_id=p_request_id and status='pending';
  if not found then raise exception 'request is not pending'; end if;
end $$;

-- Invoker execution preserves RLS. No rows or no measurements produce NULL, never invented zero tokens.
create function public.coach_usage()
returns jsonb language plpgsql stable security invoker set search_path=public,auth as $$
declare result jsonb;
begin
  if not public.account_is_active() then raise exception 'active account required' using errcode='42501'; end if;
  select jsonb_build_object(
    'period_start',date_trunc('month',now() at time zone 'UTC') at time zone 'UTC',
    'period_end',now(),'timezone','UTC',
    'scope',case public.current_account_role() when 'PLATFORM_ADMIN' then 'platform' when 'MEMBER' then 'self' else 'center' end,
    'requests',count(*),'measured_requests',count(*) filter(where input_tokens is not null and output_tokens is not null and total_tokens is not null),
    'unmeasured_requests',count(*) filter(where input_tokens is null or output_tokens is null or total_tokens is null),
    'input_tokens',sum(input_tokens),'output_tokens',sum(output_tokens),'total_tokens',sum(total_tokens)
  ) into result from public.coach_requests
  where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  return result;
end
$$;

revoke all on function public.platform_set_coach_model(text,text,boolean,boolean),public.coach_prepare(uuid,uuid,text,text),public.coach_usage() from public,anon;
grant execute on function public.platform_set_coach_model(text,text,boolean,boolean),public.coach_prepare(uuid,uuid,text,text),public.coach_usage() to authenticated;
revoke all on function public.coach_complete(uuid,uuid,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.coach_complete(uuid,uuid,text,bigint,bigint,bigint) to service_role;
commit;
