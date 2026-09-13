begin;

create or replace function public.update_member_profile(
  p_profile_id uuid,
  p_patch jsonb
)
returns setof public.member_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.accounts%rowtype;
  target public.member_profiles%rowtype;
  updated_target public.member_profiles%rowtype;
  unexpected_key text;
begin
  select * into actor from public.accounts where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.member_profiles where id = p_profile_id for update;
  if actor.id is null then
    raise exception 'active account is required';
  end if;
  if target.id is null then
    raise exception 'member profile not found';
  end if;
  if actor.role <> 'PLATFORM_ADMIN'
     and target.user_id <> actor.id
     and not (target.center_id = actor.center_id and actor.role in ('CENTER_OWNER', 'COACH')) then
    raise exception 'member profile is outside your access scope';
  end if;

  select key into unexpected_key
  from jsonb_object_keys(p_patch) as keys(key)
  where key not in (
    'name', 'phone', 'birthdate', 'gender', 'height_cm', 'weight_kg',
    'reach_cm', 'stance', 'injury_note', 'training_level'
  )
  limit 1;
  if unexpected_key is not null then
    raise exception 'unsupported profile field: %', unexpected_key;
  end if;

  if actor.role = 'MEMBER' and (p_patch ? 'reach_cm' or p_patch ? 'training_level') then
    raise exception 'members cannot change reach or training level';
  end if;

  update public.member_profiles
  set name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else name end,
      phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
      birthdate = case when p_patch ? 'birthdate' then nullif(p_patch ->> 'birthdate', '')::date else birthdate end,
      gender = case when p_patch ? 'gender' then p_patch ->> 'gender' else gender end,
      height_cm = case when p_patch ? 'height_cm' then (p_patch ->> 'height_cm')::integer else height_cm end,
      weight_kg = case when p_patch ? 'weight_kg' then (p_patch ->> 'weight_kg')::integer else weight_kg end,
      reach_cm = case when p_patch ? 'reach_cm' then (p_patch ->> 'reach_cm')::integer else reach_cm end,
      stance = case when p_patch ? 'stance' then p_patch ->> 'stance' else stance end,
      injury_note = case when p_patch ? 'injury_note' then p_patch ->> 'injury_note' else injury_note end,
      training_level = case when p_patch ? 'training_level' then (p_patch ->> 'training_level')::integer else training_level end,
      updated_at = now()
  where id = target.id
  returning * into updated_target;

  return next updated_target;
end
$$;

revoke update on public.member_profiles from authenticated;
grant execute on function public.update_member_profile(uuid, jsonb) to authenticated;

commit;
