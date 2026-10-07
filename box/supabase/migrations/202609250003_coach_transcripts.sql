begin;

create table public.coach_transcripts (
  actor_id uuid not null,
  request_id uuid not null,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  language text not null check (language in ('ko','en')),
  question text not null check (length(question) between 1 and 2000),
  answer text not null check (length(answer) between 1 and 16000),
  asked_at timestamptz not null,
  answered_at timestamptz not null default clock_timestamp(),
  primary key (actor_id,request_id),
  foreign key (actor_id,request_id) references public.coach_requests(actor_id,request_id) on delete cascade
);
create index coach_transcripts_session_order on public.coach_transcripts(session_id,asked_at,request_id);
alter table public.coach_transcripts enable row level security;
create policy coach_transcripts_read on public.coach_transcripts for select to authenticated using (
  public.account_is_active() and center_id=public.current_center_id()
  and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER')
  and exists(select 1 from public.training_sessions workout where workout.id=session_id
    and workout.center_id=coach_transcripts.center_id
    and (public.current_account_role() in ('CENTER_OWNER','COACH') or workout.user_id=auth.uid()))
);
revoke all on public.coach_transcripts from public,anon,authenticated;
grant select on public.coach_transcripts to authenticated;

create function public.coach_save_transcript(p_actor_id uuid,p_request_id uuid,p_language text,p_question text,p_answer text)
returns void language plpgsql security definer set search_path=public as $$
declare reservation public.coach_requests;
begin
  select * into reservation from public.coach_requests where actor_id=p_actor_id and request_id=p_request_id for update;
  if reservation.request_id is null or reservation.session_id is null or reservation.status not in ('pending','completed')
    or not exists(select 1 from public.training_sessions where id=reservation.session_id and center_id=reservation.center_id) then
    raise exception 'session unavailable' using errcode='42501';
  end if;
  insert into public.coach_transcripts(actor_id,request_id,session_id,center_id,language,question,answer,asked_at)
    values(p_actor_id,p_request_id,reservation.session_id,reservation.center_id,p_language,p_question,p_answer,reservation.created_at)
    on conflict(actor_id,request_id) do nothing;
  if not exists(select 1 from public.coach_transcripts where actor_id=p_actor_id and request_id=p_request_id
      and language=p_language and question=p_question and answer=p_answer) then
    raise exception 'transcript conflict' using errcode='23505';
  end if;
end $$;

create function public.coach_transcript(p_session_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,auth as $$
declare result jsonb;
begin
  if not public.account_is_active() or public.current_account_role() not in ('CENTER_OWNER','COACH','MEMBER')
    or not exists(select 1 from public.training_sessions where id=p_session_id and center_id=public.current_center_id()
      and (public.current_account_role() in ('CENTER_OWNER','COACH') or user_id=auth.uid())) then
    raise exception 'session access denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'language',language,
    'question',question,'answer',answer,'asked_at',asked_at,'answered_at',answered_at)
    order by asked_at,request_id),'[]'::jsonb) into result
    from public.coach_transcripts where session_id=p_session_id;
  return jsonb_build_object('session_id',p_session_id,'turns',result);
end $$;
revoke all on function public.coach_save_transcript(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.coach_save_transcript(uuid,uuid,text,text,text) to service_role;
revoke all on function public.coach_transcript(uuid) from public,anon;
grant execute on function public.coach_transcript(uuid) to authenticated;
commit;
