begin;

do $$
begin
  create type public.center_status as enum ('ACTIVE', 'SUSPENDED', 'CLOSED');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.subscription_status as enum ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.release_channel as enum ('STABLE', 'BETA');
exception
  when duplicate_object then null;
end
$$;

alter table public.centers
  add column if not exists status public.center_status not null default 'ACTIVE';

create table if not exists public.center_subscriptions (
  center_id uuid primary key references public.centers(id) on delete cascade,
  plan_code text not null default 'starter' check (plan_code ~ '^[a-z0-9_-]{2,40}$'),
  status public.subscription_status not null default 'TRIAL',
  starts_at date not null default current_date,
  ends_at date,
  max_members integer check (max_members is null or max_members > 0),
  updated_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint center_subscription_period_valid check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.feature_flags (
  center_id uuid not null references public.centers(id) on delete cascade,
  flag_key text not null check (flag_key ~ '^[a-z0-9_.-]{2,80}$'),
  enabled boolean not null default false,
  rollout_channel public.release_channel not null default 'STABLE',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (center_id, flag_key)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.accounts(id) on delete restrict,
  center_id uuid references public.centers(id) on delete restrict,
  target_type text not null check (target_type ~ '^[A-Z_]{2,50}$'),
  target_id text not null,
  action text not null check (action ~ '^[A-Z_]{2,80}$'),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  request_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_centers_status on public.centers(status);
create index if not exists idx_subscriptions_status_end on public.center_subscriptions(status, ends_at);
create index if not exists idx_feature_flags_center on public.feature_flags(center_id, flag_key);
create index if not exists idx_audit_logs_center_created on public.audit_logs(center_id, created_at desc);
create index if not exists idx_audit_logs_actor_created on public.audit_logs(actor_id, created_at desc);

create or replace function public.safe_request_context()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  request_headers jsonb;
begin
  request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  return jsonb_strip_nulls(jsonb_build_object(
    'user_agent', request_headers ->> 'user-agent',
    'forwarded_for', request_headers ->> 'x-forwarded-for',
    'request_id', coalesce(request_headers ->> 'x-request-id', request_headers ->> 'cf-ray')
  ));
exception
  when others then
    return '{}'::jsonb;
end
$$;

alter table public.audit_logs
  alter column request_context set default public.safe_request_context();

create or replace function public.prevent_unmanaged_center_owner_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  requested_role text;
  provisioning_nonce text;
begin
  requested_role := upper(coalesce(new.raw_user_meta_data ->> 'role', 'MEMBER'));
  provisioning_nonce := nullif(new.raw_user_meta_data ->> 'provisioning_nonce', '');
  if provisioning_nonce is null and requested_role in ('OWNER', 'CENTER_OWNER') then
    raise exception 'center owner accounts require platform provisioning';
  end if;
  return new;
end
$$;

drop trigger if exists before_auth_user_reject_unmanaged_owner on auth.users;
create trigger before_auth_user_reject_unmanaged_owner
  before insert on auth.users
  for each row execute function public.prevent_unmanaged_center_owner_signup();

create or replace function public.prevent_audit_log_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit logs are immutable';
end
$$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_change();

insert into public.center_subscriptions(center_id, plan_code, status, starts_at)
select id, 'legacy', 'ACTIVE', created_at::date
from public.centers
on conflict(center_id) do nothing;

create or replace function public.create_default_center_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.center_subscriptions(center_id, plan_code, status, starts_at, ends_at)
  values(new.id, 'trial', 'TRIAL', current_date, current_date + 13)
  on conflict(center_id) do nothing;
  return new;
end
$$;

drop trigger if exists on_center_created_subscription on public.centers;
create trigger on_center_created_subscription
  after insert on public.centers
  for each row execute function public.create_default_center_subscription();

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.accounts account
    left join public.centers center_record on center_record.id = account.center_id
    left join public.center_subscriptions subscription on subscription.center_id = account.center_id
    where account.id = auth.uid()
      and account.status = 'ACTIVE'
      and (
        account.role = 'PLATFORM_ADMIN'
        or (
          center_record.status = 'ACTIVE'
          and subscription.status in ('TRIAL', 'ACTIVE')
          and subscription.starts_at <= current_date
          and (subscription.ends_at is null or subscription.ends_at >= current_date)
        )
      )
  )
$$;

create or replace function public.require_platform_admin()
returns public.accounts
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
begin
  select * into actor
  from public.accounts
  where id = auth.uid() and status = 'ACTIVE' and role = 'PLATFORM_ADMIN';
  if actor.id is null then
    raise exception 'platform administrator role is required';
  end if;
  return actor;
end
$$;

create or replace function public.platform_create_center(
  p_name text,
  p_code text,
  p_plan_code text default 'starter',
  p_subscription_status public.subscription_status default 'TRIAL',
  p_starts_at date default current_date,
  p_ends_at date default null
)
returns setof public.centers
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.accounts%rowtype;
  created_center public.centers%rowtype;
begin
  actor := public.require_platform_admin();
  if length(btrim(p_name)) not between 2 and 100 then
    raise exception 'center name must contain 2 to 100 characters';
  end if;
  if lower(p_code) !~ '^[a-z0-9_-]{3,24}$' then
    raise exception 'invalid center code';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception 'subscription end date must not precede start date';
  end if;

  insert into public.centers(name, code, created_by)
  values(btrim(p_name), lower(p_code), actor.id)
  returning * into created_center;

  update public.center_subscriptions
  set plan_code = lower(p_plan_code),
      status = p_subscription_status,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      updated_by = actor.id,
      updated_at = now()
  where center_id = created_center.id;

  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, after_state)
  values(actor.id, created_center.id, 'CENTER', created_center.id::text, 'CENTER_CREATED', to_jsonb(created_center));

  return next created_center;
end
$$;

create or replace function public.platform_update_center(
  p_center_id uuid,
  p_patch jsonb
)
returns setof public.centers
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.accounts%rowtype;
  target public.centers%rowtype;
  updated_target public.centers%rowtype;
  unexpected_key text;
begin
  actor := public.require_platform_admin();
  select * into target from public.centers where id = p_center_id for update;
  if target.id is null then
    raise exception 'center not found';
  end if;
  select key into unexpected_key
  from jsonb_object_keys(p_patch) as keys(key)
  where key not in ('name', 'code', 'status')
  limit 1;
  if unexpected_key is not null then
    raise exception 'unsupported center field: %', unexpected_key;
  end if;

  update public.centers
  set name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else name end,
      code = case when p_patch ? 'code' then lower(p_patch ->> 'code')::extensions.citext else code end,
      status = case when p_patch ? 'status' then (p_patch ->> 'status')::public.center_status else status end,
      updated_at = now()
  where id = target.id
  returning * into updated_target;

  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, before_state, after_state)
  values(actor.id, target.id, 'CENTER', target.id::text, 'CENTER_UPDATED', to_jsonb(target), to_jsonb(updated_target));

  return next updated_target;
end
$$;

create or replace function public.platform_update_subscription(
  p_center_id uuid,
  p_patch jsonb
)
returns setof public.center_subscriptions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  target public.center_subscriptions%rowtype;
  updated_target public.center_subscriptions%rowtype;
  unexpected_key text;
begin
  actor := public.require_platform_admin();
  select * into target from public.center_subscriptions where center_id = p_center_id for update;
  if target.center_id is null then
    raise exception 'center subscription not found';
  end if;
  select key into unexpected_key
  from jsonb_object_keys(p_patch) as keys(key)
  where key not in ('plan_code', 'status', 'starts_at', 'ends_at', 'max_members')
  limit 1;
  if unexpected_key is not null then
    raise exception 'unsupported subscription field: %', unexpected_key;
  end if;

  update public.center_subscriptions
  set plan_code = case when p_patch ? 'plan_code' then lower(p_patch ->> 'plan_code') else plan_code end,
      status = case when p_patch ? 'status' then (p_patch ->> 'status')::public.subscription_status else status end,
      starts_at = case when p_patch ? 'starts_at' then (p_patch ->> 'starts_at')::date else starts_at end,
      ends_at = case when p_patch ? 'ends_at' then nullif(p_patch ->> 'ends_at', '')::date else ends_at end,
      max_members = case when p_patch ? 'max_members' then nullif(p_patch ->> 'max_members', '')::integer else max_members end,
      updated_by = actor.id,
      updated_at = now()
  where center_id = target.center_id
  returning * into updated_target;

  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, before_state, after_state)
  values(actor.id, target.center_id, 'SUBSCRIPTION', target.center_id::text, 'SUBSCRIPTION_UPDATED', to_jsonb(target), to_jsonb(updated_target));

  return next updated_target;
end
$$;

create or replace function public.platform_set_feature_flag(
  p_center_id uuid,
  p_flag_key text,
  p_enabled boolean,
  p_config jsonb default '{}'::jsonb,
  p_rollout_channel public.release_channel default 'STABLE'
)
returns setof public.feature_flags
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  previous public.feature_flags%rowtype;
  saved public.feature_flags%rowtype;
begin
  actor := public.require_platform_admin();
  if lower(p_flag_key) !~ '^[a-z0-9_.-]{2,80}$' then
    raise exception 'invalid feature flag key';
  end if;
  if jsonb_typeof(coalesce(p_config, '{}'::jsonb)) <> 'object' then
    raise exception 'feature flag config must be an object';
  end if;
  if not exists(select 1 from public.centers where id = p_center_id) then
    raise exception 'center not found';
  end if;
  select * into previous from public.feature_flags
  where center_id = p_center_id and flag_key = lower(p_flag_key);

  insert into public.feature_flags(center_id, flag_key, enabled, rollout_channel, config, updated_by)
  values(p_center_id, lower(p_flag_key), p_enabled, p_rollout_channel, coalesce(p_config, '{}'::jsonb), actor.id)
  on conflict(center_id, flag_key) do update set
    enabled = excluded.enabled,
    rollout_channel = excluded.rollout_channel,
    config = excluded.config,
    updated_by = actor.id,
    updated_at = now()
  returning * into saved;

  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, before_state, after_state)
  values(actor.id, p_center_id, 'FEATURE_FLAG', lower(p_flag_key), 'FEATURE_FLAG_UPDATED', coalesce(to_jsonb(previous), '{}'::jsonb), to_jsonb(saved));

  return next saved;
end
$$;

create or replace function public.platform_center_overview()
returns table(
  id uuid,
  name text,
  code text,
  center_status public.center_status,
  subscription_status public.subscription_status,
  plan_code text,
  starts_at date,
  ends_at date,
  max_members integer,
  owner_count bigint,
  coach_count bigint,
  member_count bigint,
  last_login_at timestamptz,
  last_session_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.require_platform_admin();
  return query
  select center_record.id,
         center_record.name,
         center_record.code::text,
         center_record.status,
         subscription.status,
         subscription.plan_code,
         subscription.starts_at,
         subscription.ends_at,
         subscription.max_members,
         count(distinct account.id) filter (where account.role = 'CENTER_OWNER'),
         count(distinct account.id) filter (where account.role = 'COACH'),
         count(distinct account.id) filter (where account.role = 'MEMBER'),
         max(auth_user.last_sign_in_at),
         max(session_record.started_at),
         center_record.created_at,
         center_record.updated_at
  from public.centers center_record
  left join public.center_subscriptions subscription on subscription.center_id = center_record.id
  left join public.accounts account on account.center_id = center_record.id
  left join auth.users auth_user on auth_user.id = account.id
  left join public.training_sessions session_record on session_record.center_id = center_record.id
  group by center_record.id, subscription.center_id
  order by center_record.created_at desc;
end
$$;

create or replace function public.admin_update_account(
  p_target_id uuid,
  p_role public.app_role default null,
  p_status public.account_status default null
)
returns setof public.accounts
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  target public.accounts%rowtype;
  updated_target public.accounts%rowtype;
begin
  select * into actor from public.accounts where id = auth.uid() and public.account_is_active();
  select * into target from public.accounts where id = p_target_id for update;
  if actor.id is null or target.id is null then
    raise exception 'account not found';
  end if;
  if target.id = actor.id and (
    coalesce(p_status, target.status) <> target.status
    or coalesce(p_role, target.role) <> target.role
  ) then
    raise exception 'cannot change the current account access';
  end if;
  if actor.role = 'CENTER_OWNER' then
    if target.center_id <> actor.center_id or target.id = actor.id or target.role not in ('COACH', 'MEMBER') then
      raise exception 'target account is outside your access scope';
    end if;
    if coalesce(p_role, target.role) not in ('COACH', 'MEMBER') then
      raise exception 'center owners can assign only COACH or MEMBER';
    end if;
  elsif actor.role <> 'PLATFORM_ADMIN' then
    raise exception 'administrator role is required';
  end if;

  update public.accounts
  set role = coalesce(p_role, role),
      status = coalesce(p_status, status),
      token_version = token_version + 1,
      updated_at = now()
  where id = target.id
  returning * into updated_target;

  insert into public.account_audit_logs(actor_id, target_id, center_id, action, before_state, after_state)
  values(actor.id, target.id, target.center_id, 'ACCOUNT_ACCESS_UPDATED', to_jsonb(target), to_jsonb(updated_target));
  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, before_state, after_state)
  values(actor.id, target.center_id, 'ACCOUNT', target.id::text, 'ACCOUNT_ACCESS_UPDATED', to_jsonb(target), to_jsonb(updated_target));

  return next updated_target;
end
$$;

create or replace function public.update_member_profile(
  p_profile_id uuid,
  p_patch jsonb
)
returns setof public.member_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  target public.member_profiles%rowtype;
  updated_target public.member_profiles%rowtype;
  unexpected_key text;
begin
  select * into actor from public.accounts where id = auth.uid() and public.account_is_active();
  select * into target from public.member_profiles where id = p_profile_id for update;
  if actor.id is null then
    raise exception 'active account is required';
  end if;
  if target.id is null then
    raise exception 'member profile not found';
  end if;
  if target.user_id <> actor.id
     and not (target.center_id = actor.center_id and actor.role in ('CENTER_OWNER', 'COACH')) then
    raise exception 'member profile is outside your access scope';
  end if;

  select key into unexpected_key
  from jsonb_object_keys(p_patch) as keys(key)
  where key not in (
    'name', 'phone', 'birthdate', 'gender', 'height_cm', 'weight_kg',
    'reach_cm', 'stance', 'injury_note', 'training_level'
  )
  limit 1;
  if unexpected_key is not null then
    raise exception 'unsupported profile field: %', unexpected_key;
  end if;
  if actor.role = 'MEMBER' and (p_patch ? 'reach_cm' or p_patch ? 'training_level') then
    raise exception 'members cannot change reach or training level';
  end if;

  update public.member_profiles
  set name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else name end,
      phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
      birthdate = case when p_patch ? 'birthdate' then nullif(p_patch ->> 'birthdate', '')::date else birthdate end,
      gender = case when p_patch ? 'gender' then p_patch ->> 'gender' else gender end,
      height_cm = case when p_patch ? 'height_cm' then (p_patch ->> 'height_cm')::integer else height_cm end,
      weight_kg = case when p_patch ? 'weight_kg' then (p_patch ->> 'weight_kg')::integer else weight_kg end,
      reach_cm = case when p_patch ? 'reach_cm' then (p_patch ->> 'reach_cm')::integer else reach_cm end,
      stance = case when p_patch ? 'stance' then p_patch ->> 'stance' else stance end,
      injury_note = case when p_patch ? 'injury_note' then p_patch ->> 'injury_note' else injury_note end,
      training_level = case when p_patch ? 'training_level' then (p_patch ->> 'training_level')::integer else training_level end,
      updated_at = now()
  where id = target.id
  returning * into updated_target;

  return next updated_target;
end
$$;

create or replace function public.save_member_calibration(
  p_profile_id uuid,
  p_calibration jsonb
)
returns setof public.member_calibrations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  profile public.member_profiles%rowtype;
  saved public.member_calibrations%rowtype;
  body_scale jsonb;
  camera_config jsonb;
  reach_text text;
  estimated_reach integer := 0;
begin
  select * into actor from public.accounts where id = auth.uid() and public.account_is_active();
  select * into profile from public.member_profiles where id = p_profile_id;
  if actor.id is null then
    raise exception 'active account is required';
  end if;
  if profile.id is null then
    raise exception 'member profile not found';
  end if;
  if profile.user_id <> actor.id
     and not (profile.center_id = actor.center_id and actor.role in ('CENTER_OWNER', 'COACH')) then
    raise exception 'member calibration is outside your access scope';
  end if;
  if coalesce((p_calibration ->> 'ready')::boolean, false) is not true then
    raise exception 'only ready calibrations can be saved';
  end if;

  body_scale := case
    when jsonb_typeof(p_calibration -> 'body_scale') = 'object' then p_calibration -> 'body_scale'
    else '{}'::jsonb
  end;
  camera_config := case
    when jsonb_typeof(p_calibration -> 'cameras') = 'array' then p_calibration -> 'cameras'
    when jsonb_typeof(p_calibration -> 'camera_config') = 'array' then p_calibration -> 'camera_config'
    else '[]'::jsonb
  end;
  reach_text := coalesce(body_scale ->> 'estimated_reach_cm', p_calibration ->> 'estimated_reach_cm', '0');
  if reach_text ~ '^[0-9]{1,3}$' then
    estimated_reach := least(300, greatest(0, reach_text::integer));
  end if;

  insert into public.member_calibrations(
    profile_id, user_id, center_id, status, completed, completed_at,
    sample_count, estimated_reach_cm, camera_config, body_scale, calibration, updated_at
  )
  values(
    profile.id,
    profile.user_id,
    profile.center_id,
    coalesce(p_calibration ->> 'status', ''),
    true,
    now(),
    case when coalesce(p_calibration ->> 'sample_count', '') ~ '^[0-9]+$'
      then (p_calibration ->> 'sample_count')::integer else 0 end,
    estimated_reach,
    camera_config,
    body_scale,
    p_calibration,
    now()
  )
  on conflict(profile_id) do update set
    status = excluded.status,
    completed = true,
    completed_at = excluded.completed_at,
    sample_count = excluded.sample_count,
    estimated_reach_cm = excluded.estimated_reach_cm,
    camera_config = excluded.camera_config,
    body_scale = excluded.body_scale,
    calibration = excluded.calibration,
    updated_at = now()
  returning * into saved;

  if estimated_reach between 100 and 250 then
    update public.member_profiles
    set reach_cm = estimated_reach, updated_at = now()
    where id = profile.id;
  end if;

  return next saved;
end
$$;

alter table public.center_subscriptions enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists subscriptions_select on public.center_subscriptions;
create policy subscriptions_select on public.center_subscriptions for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() = 'CENTER_OWNER')
  )
);

drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or center_id = public.current_center_id()
  )
);

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() = 'CENTER_OWNER')
  )
);

drop policy if exists profiles_update on public.member_profiles;
create policy profiles_update on public.member_profiles for update to authenticated using (
  public.account_is_active() and (
    user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and (
    user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists calibrations_all on public.member_calibrations;
drop policy if exists calibrations_select on public.member_calibrations;
create policy calibrations_select on public.member_calibrations for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists sessions_all on public.training_sessions;
drop policy if exists sessions_select on public.training_sessions;
drop policy if exists sessions_insert on public.training_sessions;
drop policy if exists sessions_update on public.training_sessions;
drop policy if exists sessions_delete on public.training_sessions;
create policy sessions_select on public.training_sessions for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);
create policy sessions_insert on public.training_sessions for insert to authenticated with check (
  public.account_is_active() and (
    (user_id = auth.uid() and center_id = public.current_center_id())
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);
create policy sessions_update on public.training_sessions for update to authenticated using (
  public.account_is_active() and (
    user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and (
    (user_id = auth.uid() and center_id = public.current_center_id())
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);
create policy sessions_delete on public.training_sessions for delete to authenticated using (
  public.account_is_active() and (
    user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists labels_all on public.coach_labels;
drop policy if exists labels_select on public.coach_labels;
drop policy if exists labels_insert on public.coach_labels;
create policy labels_select on public.coach_labels for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);
create policy labels_insert on public.coach_labels for insert to authenticated with check (
  public.account_is_active()
  and owner_id = auth.uid()
  and center_id = public.current_center_id()
  and public.current_account_role() in ('CENTER_OWNER', 'COACH')
);

revoke all on public.center_subscriptions, public.feature_flags, public.audit_logs from anon, authenticated;
grant select on public.center_subscriptions, public.feature_flags, public.audit_logs to authenticated;
grant execute on function public.platform_create_center(text, text, text, public.subscription_status, date, date) to authenticated;
grant execute on function public.platform_update_center(uuid, jsonb) to authenticated;
grant execute on function public.platform_update_subscription(uuid, jsonb) to authenticated;
grant execute on function public.platform_set_feature_flag(uuid, text, boolean, jsonb, public.release_channel) to authenticated;
grant execute on function public.platform_center_overview() to authenticated;
grant execute on function public.require_platform_admin() to authenticated;
grant all on public.center_subscriptions, public.feature_flags, public.audit_logs to service_role;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

commit;
