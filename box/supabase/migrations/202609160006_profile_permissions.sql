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
  select * into actor from public.accounts where id = auth.uid() and public.account_is_active();
  select * into target from public.member_profiles where id = p_profile_id for update;
  if actor.id is null or actor.role = 'PLATFORM_ADMIN' then
    raise exception 'active training account required' using errcode='42501';
  end if;
  if target.id is null then
    raise exception 'member profile not found';
  end if;
  if target.center_id is distinct from actor.center_id or (target.user_id <> actor.id
     and actor.role not in ('CENTER_OWNER', 'COACH')) then
    raise exception 'member profile is outside your access scope' using errcode='42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch)<>'object' then
    raise exception 'profile patch must be an object' using errcode='22023';
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
    raise exception 'members cannot change reach or training level' using errcode='42501';
  end if;

  if exists(select 1 from jsonb_each(p_patch) as field(key,value)
    where (key in ('name','phone','gender','stance','injury_note') and jsonb_typeof(value)<>'string')
       or (key in ('height_cm','weight_kg','reach_cm','training_level')
           and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$'))
       or (key='birthdate' and jsonb_typeof(value) not in ('string','null'))) then
    raise exception 'invalid profile field type' using errcode='22023';
  end if;
  if (p_patch ? 'name' and length(btrim(p_patch->>'name')) not between 1 and 100)
     or length(p_patch->>'phone')>40 or length(p_patch->>'gender')>40
     or length(p_patch->>'injury_note')>2000 then
    raise exception 'invalid profile field length' using errcode='22023';
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

revoke all on function public.update_member_profile(uuid,jsonb) from public,anon;
grant execute on function public.update_member_profile(uuid,jsonb) to authenticated;
commit;
