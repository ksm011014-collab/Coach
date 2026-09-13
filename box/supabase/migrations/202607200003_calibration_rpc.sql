begin;

create or replace function public.save_member_calibration(
  p_profile_id uuid,
  p_calibration jsonb
)
returns setof public.member_calibrations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  profile public.member_profiles%rowtype;
  saved public.member_calibrations%rowtype;
  body_scale jsonb;
  camera_config jsonb;
  reach_text text;
  estimated_reach integer := 0;
begin
  select * into actor from public.accounts where id = auth.uid() and status = 'ACTIVE';
  select * into profile from public.member_profiles where id = p_profile_id;
  if actor.id is null then
    raise exception 'active account is required';
  end if;
  if profile.id is null then
    raise exception 'member profile not found';
  end if;
  if actor.role <> 'PLATFORM_ADMIN'
     and profile.user_id <> actor.id
     and not (profile.center_id = actor.center_id and actor.role in ('CENTER_OWNER', 'COACH')) then
    raise exception 'member calibration is outside your access scope';
  end if;
  if coalesce((p_calibration ->> 'ready')::boolean, false) is not true then
    raise exception 'only ready calibrations can be saved';
  end if;

  body_scale := case
    when jsonb_typeof(p_calibration -> 'body_scale') = 'object' then p_calibration -> 'body_scale'
    else '{}'::jsonb
  end;
  camera_config := case
    when jsonb_typeof(p_calibration -> 'cameras') = 'array' then p_calibration -> 'cameras'
    when jsonb_typeof(p_calibration -> 'camera_config') = 'array' then p_calibration -> 'camera_config'
    else '[]'::jsonb
  end;
  reach_text := coalesce(body_scale ->> 'estimated_reach_cm', p_calibration ->> 'estimated_reach_cm', '0');
  if reach_text ~ '^[0-9]{1,3}$' then
    estimated_reach := least(300, greatest(0, reach_text::integer));
  end if;

  insert into public.member_calibrations(
    profile_id, user_id, center_id, status, completed, completed_at,
    sample_count, estimated_reach_cm, camera_config, body_scale, calibration, updated_at
  )
  values(
    profile.id,
    profile.user_id,
    profile.center_id,
    coalesce(p_calibration ->> 'status', ''),
    true,
    now(),
    case when coalesce(p_calibration ->> 'sample_count', '') ~ '^[0-9]+$'
      then (p_calibration ->> 'sample_count')::integer else 0 end,
    estimated_reach,
    camera_config,
    body_scale,
    p_calibration,
    now()
  )
  on conflict(profile_id) do update set
    status = excluded.status,
    completed = true,
    completed_at = excluded.completed_at,
    sample_count = excluded.sample_count,
    estimated_reach_cm = excluded.estimated_reach_cm,
    camera_config = excluded.camera_config,
    body_scale = excluded.body_scale,
    calibration = excluded.calibration,
    updated_at = now()
  returning * into saved;

  if estimated_reach between 100 and 250 then
    update public.member_profiles
    set reach_cm = estimated_reach, updated_at = now()
    where id = profile.id;
  end if;

  return next saved;
end
$$;

revoke insert, update on public.member_calibrations from authenticated;
grant execute on function public.save_member_calibration(uuid, jsonb) to authenticated;

commit;
