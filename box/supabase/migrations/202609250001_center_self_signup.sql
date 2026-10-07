begin;

create or replace function public.guard_auth_account_creation()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare
  provision public.account_provisioning%rowtype;
  requested_role text := upper(coalesce(new.raw_user_meta_data->>'role','MEMBER'));
begin
  if nullif(new.raw_user_meta_data->>'provisioning_nonce','') is not null then
    select * into provision from public.account_provisioning
      where nonce=(new.raw_user_meta_data->>'provisioning_nonce')::uuid and expires_at>now() for update;
    if not found then raise exception 'provisioning expired' using errcode='42501'; end if;
    perform public.check_provisioning_actor(provision.created_by,provision.creator_token_version,provision.role,provision.center_id);
  elsif requested_role in ('OWNER','CENTER_OWNER') then
    if length(btrim(coalesce(new.raw_user_meta_data->>'center_name',''))) not between 2 and 100 then
      raise exception 'center name must contain 2 to 100 characters' using errcode='22023';
    end if;
    if nullif(new.raw_user_meta_data->>'center_id','') is not null then
      raise exception 'self signup must create a new center' using errcode='42501';
    end if;
  elsif requested_role='MEMBER' then
    if not exists(select 1 from public.centers c join public.center_subscriptions s on s.center_id=c.id
      where c.code=lower(new.raw_user_meta_data->>'center_code')::extensions.citext
        and c.status='ACTIVE' and s.status in ('TRIAL','ACTIVE') and s.starts_at<=current_date
        and (s.ends_at is null or s.ends_at>=current_date)) then
      raise exception 'signup center is unavailable' using errcode='42501';
    end if;
  else
    raise exception 'public signup role is not allowed' using errcode='42501';
  end if;
  return new;
end
$$;
revoke all on function public.guard_auth_account_creation() from public,anon,authenticated;

create or replace function public.audit_center_self_signup()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare account public.accounts%rowtype;
begin
  if nullif(new.raw_user_meta_data->>'provisioning_nonce','') is null
     and upper(new.raw_user_meta_data->>'role') in ('OWNER','CENTER_OWNER') then
    select * into strict account from public.accounts where id=new.id;
    insert into public.audit_logs(actor_id,center_id,target_type,target_id,action,before_state,after_state)
      values(account.id,account.center_id,'CENTER',account.center_id::text,'CENTER_CREATED','{}',
        jsonb_build_object('source','SELF_SIGNUP','owner_id',account.id));
  end if;
  return new;
end
$$;
revoke all on function public.audit_center_self_signup() from public,anon,authenticated;
drop trigger if exists zy_audit_center_self_signup on auth.users;
create trigger zy_audit_center_self_signup after insert on auth.users
  for each row execute function public.audit_center_self_signup();

commit;
