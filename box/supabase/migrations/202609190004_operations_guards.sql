begin;

create function public.guard_operational_profile_update()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare member public.operation_members%rowtype;
begin
  select * into member from public.operation_members where member_id=old.user_id for update;
  if member.deleted_on is not null then raise exception 'deleted member profile is read-only' using errcode='42501'; end if;
  if member.member_id is not null then
    update public.operation_members set version=version+1 where member_id=member.member_id;
    if auth.uid() is not null then
      insert into public.operation_audit(id,center_id,actor_id,operation,target_id,before_state,after_state,created_at)
        values(extensions.gen_random_uuid(),member.center_id,auth.uid(),'member.profile_update',member.member_id::text,to_jsonb(old),to_jsonb(new),now());
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_operational_profile_update() from public,anon,authenticated;
create trigger guard_operational_profile_update before update on public.member_profiles
  for each row execute function public.guard_operational_profile_update();

create function public.guard_deleted_member_account()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='ACTIVE' and exists(select 1 from public.operation_members where member_id=new.id and deleted_on is not null) then
    raise exception 'deleted member cannot be reactivated through account permissions' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_deleted_member_account() from public,anon,authenticated;
create trigger guard_deleted_member_account before update on public.accounts
  for each row execute function public.guard_deleted_member_account();

create function public.guard_registration_request_key()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.operation_registrations where actor_id=new.actor_id and request_id=new.request_id and result is null) then
    raise exception 'request_id belongs to an unfinished registration' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function public.guard_registration_request_key() from public,anon,authenticated;
create trigger guard_registration_request_key before insert on public.operation_requests
  for each row execute function public.guard_registration_request_key();

commit;
