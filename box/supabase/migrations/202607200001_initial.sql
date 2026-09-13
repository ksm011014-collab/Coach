begin;

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.app_role as enum ('PLATFORM_ADMIN', 'CENTER_OWNER', 'COACH', 'MEMBER');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.account_status as enum ('ACTIVE', 'SUSPENDED');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.centers (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 100),
  code extensions.citext not null unique check (code ~ '^[a-z0-9_-]{3,24}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  center_id uuid references public.centers(id) on delete restrict,
  username extensions.citext not null unique check (username ~ '^[a-z0-9_]{4,20}$'),
  contact_email text not null default '',
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role public.app_role not null,
  status public.account_status not null default 'ACTIVE',
  token_version integer not null default 1 check (token_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_center_required check (role = 'PLATFORM_ADMIN' or center_id is not null)
);

create table if not exists public.member_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references public.accounts(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  name text not null,
  phone text not null default '',
  birthdate date,
  gender text not null default '',
  height_cm integer not null default 170 check (height_cm between 100 and 250),
  weight_kg integer not null default 70 check (weight_kg between 25 and 300),
  reach_cm integer not null default 0 check (reach_cm between 0 and 300),
  stance text not null default 'orthodox' check (stance in ('orthodox', 'southpaw')),
  injury_note text not null default '',
  training_level integer not null default 1 check (training_level between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_calibrations (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null unique references public.member_profiles(id) on delete cascade,
  user_id uuid not null references public.accounts(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  status text not null default '',
  completed boolean not null default false,
  completed_at timestamptz,
  sample_count integer not null default 0 check (sample_count >= 0),
  estimated_reach_cm integer not null default 0 check (estimated_reach_cm between 0 and 300),
  camera_config jsonb not null default '[]'::jsonb,
  body_scale jsonb not null default '{}'::jsonb,
  calibration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.training_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.accounts(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  camera_config jsonb not null default '[]'::jsonb,
  overall_score integer not null default 0 check (overall_score between 0 and 100),
  focus text not null default 'guard_and_strikes',
  feedback_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_labels (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  owner_id uuid not null references public.accounts(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  label text not null,
  comment text not null default '',
  use_for_training boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.account_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.accounts(id) on delete restrict,
  target_id uuid not null references public.accounts(id) on delete restrict,
  center_id uuid references public.centers(id) on delete restrict,
  action text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.account_provisioning (
  nonce uuid primary key default extensions.gen_random_uuid(),
  username extensions.citext not null,
  contact_email text not null default '',
  display_name text not null,
  role public.app_role not null,
  center_id uuid references public.centers(id) on delete cascade,
  created_by uuid not null references public.accounts(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  constraint account_provisioning_center_required check (role = 'PLATFORM_ADMIN' or center_id is not null)
);

create index if not exists idx_accounts_center on public.accounts(center_id);
create index if not exists idx_member_profiles_center on public.member_profiles(center_id);
create index if not exists idx_training_sessions_center_user on public.training_sessions(center_id, user_id, started_at desc);
create index if not exists idx_calibrations_center on public.member_calibrations(center_id);
create index if not exists idx_audit_logs_center_created on public.account_audit_logs(center_id, created_at desc);

create or replace function public.current_account_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select role from public.accounts where id = auth.uid() and status = 'ACTIVE'
$$;

create or replace function public.current_center_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select center_id from public.accounts where id = auth.uid() and status = 'ACTIVE'
$$;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(select 1 from public.accounts where id = auth.uid() and status = 'ACTIVE')
$$;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_username ~ '^[a-z0-9_]{4,20}$'
    and not exists(select 1 from public.accounts where username = lower(p_username)::extensions.citext)
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  requested_role text;
  normalized_username text;
  target_center public.centers%rowtype;
  provision public.account_provisioning%rowtype;
  provision_nonce uuid;
  center_code text;
begin
  normalized_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if normalized_username !~ '^[a-z0-9_]{4,20}$' then
    raise exception 'invalid username';
  end if;

  provision_nonce := nullif(new.raw_user_meta_data ->> 'provisioning_nonce', '')::uuid;
  if provision_nonce is not null then
    select * into provision
      from public.account_provisioning
      where nonce = provision_nonce and expires_at > now()
      for update;
    if not found or provision.username <> normalized_username::extensions.citext then
      raise exception 'invalid or expired account provisioning request';
    end if;

    insert into public.accounts(id, center_id, username, contact_email, display_name, role)
    values(new.id, provision.center_id, provision.username, provision.contact_email, provision.display_name, provision.role);
    if provision.role = 'MEMBER' then
      insert into public.member_profiles(user_id, center_id, name)
      values(new.id, provision.center_id, provision.display_name);
    end if;
    delete from public.account_provisioning where nonce = provision_nonce;
    return new;
  end if;

  requested_role := upper(coalesce(new.raw_user_meta_data ->> 'role', 'MEMBER'));
  if requested_role = 'OWNER' then
    requested_role := 'CENTER_OWNER';
  end if;
  if requested_role not in ('CENTER_OWNER', 'MEMBER') then
    raise exception 'public signup role is not allowed';
  end if;

  if requested_role = 'CENTER_OWNER' then
    center_code := lower(coalesce(
      nullif(new.raw_user_meta_data ->> 'center_code', ''),
      nullif(regexp_replace(new.raw_user_meta_data ->> 'center_name', '[^a-zA-Z0-9_-]', '', 'g'), ''),
      'center-' || substr(new.id::text, 1, 8)
    ));
    center_code := substr(center_code, 1, 24);
    if length(center_code) < 3 then
      center_code := 'center-' || substr(new.id::text, 1, 8);
    end if;
    while exists(select 1 from public.centers where code = center_code::extensions.citext) loop
      center_code := substr(center_code, 1, 15) || '-' || substr(extensions.gen_random_uuid()::text, 1, 8);
    end loop;
    insert into public.centers(name, code, created_by)
    values(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'center_name'), ''), 'Boxing Center'), center_code, new.id)
    returning * into target_center;
  else
    select * into target_center
      from public.centers
      where code = lower(coalesce(new.raw_user_meta_data ->> 'center_code', ''))::extensions.citext;
    if not found then
      raise exception 'valid center code is required';
    end if;
  end if;

  insert into public.accounts(id, center_id, username, contact_email, display_name, role)
  values(
    new.id,
    target_center.id,
    normalized_username,
    coalesce(new.raw_user_meta_data ->> 'contact_email', ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), normalized_username),
    requested_role::public.app_role
  );

  if requested_role = 'MEMBER' then
    insert into public.member_profiles(user_id, center_id, name, phone)
    values(
      new.id,
      target_center.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), normalized_username),
      coalesce(new.raw_user_meta_data ->> 'phone', '')
    );
  end if;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

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
  select * into actor from public.accounts where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.accounts where id = p_target_id for update;
  if actor.id is null or target.id is null then
    raise exception 'account not found';
  end if;
  if target.id = actor.id and coalesce(p_status, target.status) = 'SUSPENDED' then
    raise exception 'cannot suspend the current account';
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

  return next updated_target;
end
$$;

alter table public.centers enable row level security;
alter table public.accounts enable row level security;
alter table public.member_profiles enable row level security;
alter table public.member_calibrations enable row level security;
alter table public.training_sessions enable row level security;
alter table public.coach_labels enable row level security;
alter table public.account_audit_logs enable row level security;
alter table public.account_provisioning enable row level security;

drop policy if exists centers_select on public.centers;
create policy centers_select on public.centers for select to authenticated using (
  public.account_is_active() and (public.current_account_role() = 'PLATFORM_ADMIN' or id = public.current_center_id())
);

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated using (
  public.account_is_active() and (
    id = auth.uid()
    or public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() = 'CENTER_OWNER')
    or (center_id = public.current_center_id() and public.current_account_role() = 'COACH' and role = 'MEMBER')
  )
);

drop policy if exists profiles_select on public.member_profiles;
create policy profiles_select on public.member_profiles for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists profiles_update on public.member_profiles;
create policy profiles_update on public.member_profiles for update to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists calibrations_all on public.member_calibrations;
create policy calibrations_all on public.member_calibrations for all to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists sessions_all on public.training_sessions;
create policy sessions_all on public.training_sessions for all to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or user_id = auth.uid()
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (user_id = auth.uid() and center_id = public.current_center_id())
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists labels_all on public.coach_labels;
create policy labels_all on public.coach_labels for all to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
) with check (
  public.account_is_active() and owner_id = auth.uid() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() in ('CENTER_OWNER', 'COACH'))
  )
);

drop policy if exists audit_logs_select on public.account_audit_logs;
create policy audit_logs_select on public.account_audit_logs for select to authenticated using (
  public.account_is_active() and (
    public.current_account_role() = 'PLATFORM_ADMIN'
    or (center_id = public.current_center_id() and public.current_account_role() = 'CENTER_OWNER')
  )
);

revoke all on public.account_provisioning from anon, authenticated;
grant select on public.centers, public.accounts, public.member_profiles, public.member_calibrations,
  public.training_sessions, public.coach_labels, public.account_audit_logs to authenticated;
grant insert, update on public.member_profiles, public.member_calibrations, public.training_sessions,
  public.coach_labels to authenticated;
grant delete on public.training_sessions to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.admin_update_account(uuid, public.app_role, public.account_status) to authenticated;
grant execute on function public.current_account_role() to authenticated;
grant execute on function public.current_center_id() to authenticated;
grant execute on function public.account_is_active() to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;
