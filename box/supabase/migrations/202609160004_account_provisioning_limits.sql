begin;

alter table public.account_provisioning add column if not exists creator_token_version integer;

create or replace function public.check_provisioning_actor(
  p_actor uuid, p_version integer, p_role public.app_role, p_center uuid
)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.accounts%rowtype;
begin
  select * into actor from public.accounts where id=p_actor for share;
  if actor.id is null or actor.status<>'ACTIVE' or p_version is distinct from actor.token_version then
    raise exception 'provisioning actor is no longer active' using errcode='42501';
  end if;
  if actor.role='PLATFORM_ADMIN' then return; end if;
  if actor.role<>'CENTER_OWNER' or p_role not in ('COACH','MEMBER')
     or p_center is distinct from actor.center_id then
    raise exception 'provisioning target is outside actor scope' using errcode='42501';
  end if;
  if not exists(select 1 from public.centers c join public.center_subscriptions s on s.center_id=c.id
    where c.id=actor.center_id and c.status='ACTIVE' and s.status in ('TRIAL','ACTIVE')
      and s.starts_at<=current_date and (s.ends_at is null or s.ends_at>=current_date)) then
    raise exception 'provisioning center is unavailable' using errcode='42501';
  end if;
end
$$;
revoke all on function public.check_provisioning_actor(uuid,integer,public.app_role,uuid) from public,anon,authenticated;

create or replace function public.guard_provisioning_request()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.check_provisioning_actor(new.created_by,new.creator_token_version,new.role,new.center_id);
  return new;
end
$$;
drop trigger if exists guard_provisioning_request on public.account_provisioning;
create trigger guard_provisioning_request before insert or update on public.account_provisioning
  for each row execute function public.guard_provisioning_request();

create or replace function public.guard_auth_account_creation()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare provision public.account_provisioning%rowtype;
begin
  if nullif(new.raw_user_meta_data->>'provisioning_nonce','') is not null then
    select * into provision from public.account_provisioning
      where nonce=(new.raw_user_meta_data->>'provisioning_nonce')::uuid and expires_at>now() for update;
    if not found then raise exception 'provisioning expired' using errcode='42501'; end if;
    perform public.check_provisioning_actor(provision.created_by,provision.creator_token_version,provision.role,provision.center_id);
  else
    if not exists(select 1 from public.centers c join public.center_subscriptions s on s.center_id=c.id
      where c.code=lower(new.raw_user_meta_data->>'center_code')::extensions.citext
        and c.status='ACTIVE' and s.status in ('TRIAL','ACTIVE') and s.starts_at<=current_date
        and (s.ends_at is null or s.ends_at>=current_date)) then
      raise exception 'signup center is unavailable' using errcode='42501';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists before_auth_user_guard_provisioning on auth.users;
create trigger before_auth_user_guard_provisioning before insert on auth.users
  for each row execute function public.guard_auth_account_creation();

create or replace function public.enforce_member_capacity()
returns trigger language plpgsql security definer set search_path=public as $$
declare capacity integer;
begin
  if new.role<>'MEMBER' then return new; end if;
  if tg_op='UPDATE' then
    if old.role='MEMBER' and new.center_id is not distinct from old.center_id then return new; end if;
  end if;
  -- Count all MEMBER accounts, matching platform_center_overview. Suspension
  -- does not release a member slot. Serialize entrants using the subscription row.
  select max_members into capacity from public.center_subscriptions where center_id=new.center_id for update;
  if not found then raise exception 'center subscription missing' using errcode='23514'; end if;
  if capacity is not null and (select count(*) from public.accounts
      where center_id=new.center_id and role='MEMBER' and id<>new.id)>=capacity then
    raise exception 'center member capacity reached' using errcode='23514';
  end if;
  return new;
end
$$;
drop trigger if exists enforce_member_capacity on public.accounts;
create trigger enforce_member_capacity before insert or update of role,center_id on public.accounts
  for each row execute function public.enforce_member_capacity();

create or replace function public.audit_provisioned_account()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare actor_id uuid; snapshot jsonb;
begin
  select p.created_by into actor_id from public.account_provisioning p join auth.users u
    on p.nonce=nullif(u.raw_user_meta_data->>'provisioning_nonce','')::uuid where u.id=new.id;
  if actor_id is not null then
    snapshot := jsonb_build_object('role',new.role,'status',new.status,'token_version',new.token_version);
    insert into public.account_audit_logs(actor_id,target_id,center_id,action,before_state,after_state)
      values(actor_id,new.id,new.center_id,'ACCOUNT_CREATED','{}',snapshot);
    insert into public.audit_logs(actor_id,center_id,target_type,target_id,action,before_state,after_state)
      values(actor_id,new.center_id,'ACCOUNT',new.id::text,'ACCOUNT_CREATED','{}',snapshot);
  end if;
  return new;
end
$$;
drop trigger if exists audit_provisioned_account on public.accounts;
create trigger audit_provisioned_account after insert on public.accounts
  for each row execute function public.audit_provisioned_account();
commit;
