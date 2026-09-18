begin;

alter table public.training_sessions add column if not exists created_by uuid references public.accounts(id);
alter table public.training_sessions add column if not exists request_id text;
create unique index if not exists sessions_creator_request_unique
  on public.training_sessions(created_by,request_id) where request_id is not null;

create or replace function public.guard_session_write()
returns trigger language plpgsql set search_path=public,auth as $$
begin
  if tg_op='INSERT' then
    if new.overall_score<>0 or new.feedback_report<>'{}'::jsonb then
      raise exception 'analysis is unavailable' using errcode='23514';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.started_at := now();
      new.ended_at := null;
    end if;
  else
    if (new.created_by,new.request_id,new.started_at,new.camera_config,new.focus,new.overall_score,new.feedback_report)
       is distinct from
       (old.created_by,old.request_id,old.started_at,old.camera_config,old.focus,old.overall_score,old.feedback_report) then
      raise exception 'only session termination may be changed' using errcode='23514';
    end if;
    if old.ended_at is not null then
      new.ended_at := old.ended_at;
    elsif new.ended_at is not null then
      new.ended_at := now();
    end if;
  end if;
  if new.request_id is not null and length(new.request_id) not between 1 and 128 then
    raise exception 'invalid request_id' using errcode='22023';
  end if;
  return new;
end
$$;
drop trigger if exists guard_session_write on public.training_sessions;
create trigger guard_session_write before insert or update on public.training_sessions
  for each row execute function public.guard_session_write();

create or replace function public.start_training_session(
  p_user_id uuid, p_camera_config jsonb default '[]',
  p_focus text default 'free_training', p_request_id text default null
)
returns setof public.training_sessions language plpgsql security invoker
set search_path=public,auth as $$
declare
  target public.accounts%rowtype;
  previous public.training_sessions%rowtype;
begin
  if not public.account_is_active() then
    raise exception 'active account required' using errcode='42501';
  end if;
  if p_focus is null or length(p_focus) not between 1 and 100
     or p_camera_config is null or jsonb_typeof(p_camera_config)<>'array'
     or jsonb_array_length(p_camera_config)>3
     or (p_request_id is not null and length(p_request_id) not between 1 and 128) then
    raise exception 'invalid session request' using errcode='22023';
  end if;
  select * into target from public.accounts where id=p_user_id and status='ACTIVE';
  if not found or target.center_id is distinct from public.current_center_id()
    or public.current_account_role()='PLATFORM_ADMIN'
    or (public.current_account_role()='MEMBER' and target.id<>auth.uid()) then
    raise exception 'target is outside training scope' using errcode='42501';
  end if;
  if p_request_id is not null then
    -- Serialize identical keys before lookup. The unique index remains the
    -- authority even for clients that bypass this RPC and use table writes.
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id,0));
    select * into previous from public.training_sessions
      where created_by=auth.uid() and request_id=p_request_id;
    if found then
      if (previous.user_id,previous.camera_config,previous.focus)
         is distinct from (p_user_id,p_camera_config,p_focus) then
        raise exception 'request_id already used for another request' using errcode='23505';
      end if;
      return next previous;
      return;
    end if;
  end if;
  return query insert into public.training_sessions(user_id,center_id,camera_config,focus,created_by,request_id)
    values(target.id,target.center_id,p_camera_config,p_focus,auth.uid(),p_request_id)
    returning *;
end
$$;

create or replace function public.end_training_session(p_session_id uuid)
returns setof public.training_sessions language plpgsql security invoker
set search_path=public,auth as $$
begin
  return query update public.training_sessions set ended_at=coalesce(ended_at,now())
    where id=p_session_id returning *;
end
$$;
revoke all on function public.start_training_session(uuid,jsonb,text,text), public.end_training_session(uuid) from public,anon;
grant execute on function public.start_training_session(uuid,jsonb,text,text), public.end_training_session(uuid) to authenticated;
commit;
