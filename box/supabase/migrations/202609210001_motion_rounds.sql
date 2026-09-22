begin;

create function public.normalize_motion_report(report jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
  duration numeric; event jsonb; previous jsonb; events jsonb := '[]'; ids text[] := '{}';
  counts jsonb := '{"jab":0,"hook":0,"uppercut":0,"one_two":0}';
  field text; value numeric; start_ms numeric; end_ms numeric; last_end numeric := -1;
  quality numeric; confidence numeric; points integer; total integer := 0; quality_sum integer := 0;
  label text; hand text; identifier text;
begin
  if jsonb_typeof(report) is distinct from 'object' or report->'version' is distinct from '1'::jsonb
    or coalesce(report->>'status','') not in ('experimental','unavailable')
    or report->>'algorithm' is distinct from 'rules-v1'
    or coalesce(report->>'stance','') not in ('orthodox','southpaw') then
    raise exception 'invalid motion report' using errcode='22023';
  end if;
  if jsonb_typeof(report->'duration_ms') is distinct from 'number' then
    raise exception 'invalid duration' using errcode='22023';
  end if;
  duration := (report->>'duration_ms')::numeric;
  if duration<0 or duration>3600000 or duration<>trunc(duration) or jsonb_typeof(report->'events') is distinct from 'array' then
    raise exception 'invalid motion duration or events' using errcode='22023';
  end if;
  if jsonb_array_length(report->'events')>1000 or (report->>'status'='unavailable' and jsonb_array_length(report->'events')>0) then
    raise exception 'invalid event count' using errcode='22023';
  end if;
  for event in select * from jsonb_array_elements(report->'events') loop
    identifier := event->>'id'; label := event->>'label'; hand := event->>'hand';
    if jsonb_typeof(event) is distinct from 'object' or jsonb_typeof(event->'id') is distinct from 'string'
      or length(identifier) not between 1 and 96 or identifier=any(ids)
      or coalesce(label,'') not in ('jab','hook','uppercut','one_two') or coalesce(hand,'') not in ('left','right','both')
      or ((label='one_two')<>(hand='both'))
      or (label='jab' and hand<>case when report->>'stance'='orthodox' then 'left' else 'right' end) then
      raise exception 'invalid event identity' using errcode='22023';
    end if;
    ids := array_append(ids,identifier);
    foreach field in array array['start_ms','end_ms','quality','confidence'] loop
      if jsonb_typeof(event->field) is distinct from 'number' then
        raise exception 'invalid event number' using errcode='22023';
      end if;
      value := (event->>field)::numeric;
      if field<>'confidence' and value<>trunc(value) then
        raise exception 'integer event value required' using errcode='22023';
      end if;
    end loop;
    start_ms := (event->>'start_ms')::numeric; end_ms := (event->>'end_ms')::numeric;
    quality := (event->>'quality')::numeric; confidence := (event->>'confidence')::numeric;
    if start_ms<0 or end_ms<start_ms or end_ms>duration or end_ms<last_end or quality<0 or quality>100 or confidence<0.65 or confidence>1 then
      raise exception 'invalid event bounds' using errcode='22023';
    end if;
    for previous in select * from jsonb_array_elements(events) loop
      if start_ms<(previous->>'end_ms')::numeric and (hand='both' or previous->>'hand'='both' or hand=previous->>'hand') then
        raise exception 'overlapping event' using errcode='22023';
      end if;
    end loop;
    last_end := end_ms;
    points := greatest(1,round(quality/10)::integer) * case when label='one_two' then 2 else 1 end;
    total := total+points; quality_sum := quality_sum+quality::integer;
    counts := jsonb_set(counts,array[label],to_jsonb((counts->>label)::integer+1));
    events := events || jsonb_build_array(jsonb_build_object('id',identifier,'label',label,'hand',hand,'start_ms',start_ms,'end_ms',end_ms,'quality',quality,'confidence',confidence,'points',points));
  end loop;
  return jsonb_build_object('version',1,'status',report->>'status','algorithm','rules-v1','source','device_estimate','stance',report->>'stance','duration_ms',duration,'events',events,'counts',counts,'total_points',total,'mean_quality',case when jsonb_array_length(events)>0 then round(quality_sum::numeric/jsonb_array_length(events)) else null end);
end
$$;
revoke all on function public.normalize_motion_report(jsonb) from public,anon,authenticated;

create or replace function public.guard_session_write()
returns trigger language plpgsql set search_path=public,auth as $$
begin
  if tg_op='INSERT' then
    if new.overall_score<>0 or new.feedback_report<>'{}'::jsonb then
      raise exception 'new sessions cannot contain analysis' using errcode='23514';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid(); new.started_at := now(); new.ended_at := null;
    end if;
  else
    if (new.created_by,new.request_id,new.started_at,new.camera_config,new.focus)
      is distinct from (old.created_by,old.request_id,old.started_at,old.camera_config,old.focus) then
      raise exception 'session metadata is immutable' using errcode='23514';
    end if;
    if (new.overall_score,new.feedback_report) is distinct from (old.overall_score,old.feedback_report) then
      if current_user <> pg_get_userbyid((select relowner from pg_class where oid=tg_relid)) then
        raise exception 'round result requires guarded RPC' using errcode='42501';
      end if;
      if old.feedback_report<>'{}'::jsonb or new.feedback_report is distinct from public.normalize_motion_report(new.feedback_report)
        or new.overall_score<>coalesce((new.feedback_report->>'mean_quality')::integer,0) then
        raise exception 'invalid or finalized round result' using errcode='23514';
      end if;
    end if;
    if old.ended_at is not null then new.ended_at := old.ended_at;
    elsif new.ended_at is not null then new.ended_at := now(); end if;
  end if;
  if new.request_id is not null and length(new.request_id) not between 1 and 128 then
    raise exception 'invalid request_id' using errcode='22023';
  end if;
  return new;
end
$$;

create function public.finish_motion_round(p_session_id uuid,p_report jsonb)
returns setof public.training_sessions language plpgsql security definer set search_path=public,auth as $$
declare
  target public.training_sessions%rowtype;
  actor public.accounts%rowtype;
  normalized jsonb;
begin
  select * into actor from public.accounts where id=auth.uid() for share;
  if actor.id is null or not public.account_is_active() or actor.role not in ('CENTER_OWNER','COACH','MEMBER') then
    raise exception 'active training role required' using errcode='42501';
  end if;
  select * into target from public.training_sessions where id=p_session_id and center_id=actor.center_id
    and (actor.role in ('CENTER_OWNER','COACH') or user_id=actor.id) for update;
  if target.id is null then raise exception 'session not found' using errcode='P0002'; end if;
  normalized := public.normalize_motion_report(p_report);
  if (normalized->>'duration_ms')::numeric > greatest(0,extract(epoch from (coalesce(target.ended_at,now())-target.started_at))*1000)+1000 then
    raise exception 'motion duration exceeds session' using errcode='22023';
  end if;
  if target.feedback_report<>'{}'::jsonb then
    if target.feedback_report<>normalized then raise exception 'round result already finalized' using errcode='23505'; end if;
    return next target; return;
  end if;
  update public.training_sessions set ended_at=coalesce(ended_at,now()),overall_score=coalesce((normalized->>'mean_quality')::integer,0),feedback_report=normalized
    where id=p_session_id returning * into target;
  insert into public.operation_audit(id,center_id,actor_id,operation,target_id,before_state,after_state,created_at)
    values(gen_random_uuid(),actor.center_id,actor.id,'round.finish',p_session_id::text,'{}',jsonb_build_object('total_points',normalized->'total_points','events',jsonb_array_length(normalized->'events'),'status',normalized->>'status'),now());
  return next target;
end
$$;
revoke all on function public.finish_motion_round(uuid,jsonb) from public,anon;
grant execute on function public.finish_motion_round(uuid,jsonb) to authenticated;

commit;
