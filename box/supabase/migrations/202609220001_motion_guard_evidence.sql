begin;

create or replace function public.normalize_motion_report(report jsonb)
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
    if event ? 'guard_ratio' then
      if jsonb_typeof(event->'guard_ratio') is distinct from 'number' then
        raise exception 'invalid guard observation' using errcode='22023';
      end if;
      if (event->>'guard_ratio')::numeric<0 or (event->>'guard_ratio')::numeric>1 then
        raise exception 'invalid guard bounds' using errcode='22023';
      end if;
    end if;
    last_end := end_ms;
    points := greatest(1,round(quality/10)::integer) * case when label='one_two' then 2 else 1 end;
    total := total+points; quality_sum := quality_sum+quality::integer;
    counts := jsonb_set(counts,array[label],to_jsonb((counts->>label)::integer+1));
    events := events || jsonb_build_array(jsonb_build_object('id',identifier,'label',label,'hand',hand,'start_ms',start_ms,'end_ms',end_ms,'quality',quality,'confidence',confidence,'points',points) || case when event ? 'guard_ratio' then jsonb_build_object('guard_ratio',event->'guard_ratio') else '{}'::jsonb end);
  end loop;
  return jsonb_build_object('version',1,'status',report->>'status','algorithm','rules-v1','source','device_estimate','stance',report->>'stance','duration_ms',duration,'events',events,'counts',counts,'total_points',total,'mean_quality',case when jsonb_array_length(events)>0 then round(quality_sum::numeric/jsonb_array_length(events)) else null end);
end
$$;
revoke all on function public.normalize_motion_report(jsonb) from public,anon,authenticated;

commit;

