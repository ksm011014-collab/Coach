begin;

-- Enable this hook in Supabase Auth before releasing clients that rely on it.
-- Tokens without this server-issued claim fail closed and require re-login.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer
set search_path=public,auth as $$
declare
  version integer;
  claims jsonb;
begin
  select token_version into version from public.accounts where id=(event->>'user_id')::uuid;
  claims := coalesce(event->'claims','{}'::jsonb)
    || jsonb_build_object('app_token_version',coalesce(version,0));
  return jsonb_build_object('claims',claims);
end
$$;
revoke all on function public.custom_access_token_hook(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

create or replace function public.account_is_active()
returns boolean language sql stable security definer
set search_path=public,auth as $$
  select exists(
    select 1 from public.accounts account
    left join public.centers center_record on center_record.id=account.center_id
    left join public.center_subscriptions subscription on subscription.center_id=account.center_id
    where account.id=auth.uid() and account.status='ACTIVE'
      and auth.jwt()->'app_token_version'=to_jsonb(account.token_version)
      and (account.role='PLATFORM_ADMIN' or (
        center_record.status='ACTIVE' and subscription.status in ('TRIAL','ACTIVE')
        and subscription.starts_at<=current_date
        and (subscription.ends_at is null or subscription.ends_at>=current_date)
      ))
  )
$$;

create or replace function public.current_account_role()
returns public.app_role language sql stable security definer
set search_path=public,auth as $$
  select role from public.accounts where id=auth.uid() and public.account_is_active()
$$;
create or replace function public.current_center_id()
returns uuid language sql stable security definer
set search_path=public,auth as $$
  select center_id from public.accounts where id=auth.uid() and public.account_is_active()
$$;
create or replace function public.require_platform_admin()
returns public.accounts language plpgsql stable security definer
set search_path=public,auth as $$
declare actor public.accounts%rowtype;
begin
  select * into actor from public.accounts
    where id=auth.uid() and role='PLATFORM_ADMIN' and public.account_is_active();
  if actor.id is null then
    raise exception 'active platform administrator required' using errcode='42501';
  end if;
  return actor;
end
$$;

revoke all on function public.account_is_active(), public.current_account_role(), public.current_center_id(), public.require_platform_admin() from public,anon;
grant execute on function public.account_is_active(), public.current_account_role(), public.current_center_id(), public.require_platform_admin() to authenticated;
commit;
