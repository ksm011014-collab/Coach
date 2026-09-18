begin;
create or replace function public.revoke_own_access_tokens()
returns void language sql security definer set search_path=public,auth as $$
  update public.accounts set token_version=token_version+1,updated_at=now()
  where id=auth.uid() and auth.jwt()->'app_token_version'=to_jsonb(token_version)
$$;
revoke all on function public.revoke_own_access_tokens() from public,anon;
grant execute on function public.revoke_own_access_tokens() to authenticated;
commit;
