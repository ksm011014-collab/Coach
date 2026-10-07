begin;

create table if not exists public.staff_notes (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete restrict,
  note text not null default '' check (length(note) <= 2000),
  updated_at timestamptz not null default now()
);
create index if not exists staff_notes_center_idx on public.staff_notes(center_id);
alter table public.staff_notes enable row level security;
revoke all on public.staff_notes from anon, authenticated;
grant select on public.staff_notes to authenticated;
grant all on public.staff_notes to service_role;
drop policy if exists staff_notes_read on public.staff_notes;
create policy staff_notes_read on public.staff_notes for select to authenticated using (
  public.account_is_active() and exists (
    select 1 from public.accounts actor where actor.id = auth.uid()
    and (actor.role = 'PLATFORM_ADMIN' or (actor.role = 'CENTER_OWNER' and actor.center_id = staff_notes.center_id))
  )
);

create or replace function public.admin_update_staff(
  p_target_id uuid, p_role public.app_role, p_status public.account_status, p_note text
)
returns setof public.accounts language plpgsql security definer set search_path = public, auth
as $$
declare
  target public.accounts%rowtype;
begin
  if p_note is null or length(p_note) > 2000 then
    raise exception 'invalid staff note' using errcode = '22023';
  end if;
  select * into target from public.accounts where id = p_target_id for update;
  if target.role is distinct from 'COACH'::public.app_role or target.center_id is null then
    raise exception 'staff account required' using errcode = '42501';
  end if;
  if not public.account_is_active() or not exists (
    select 1 from public.accounts actor where actor.id = auth.uid() and (
      actor.role = 'PLATFORM_ADMIN' or (actor.role = 'CENTER_OWNER' and actor.center_id = target.center_id and actor.id <> target.id)
    )
  ) then
    raise exception 'staff administration denied' using errcode = '42501';
  end if;
  if coalesce(p_role, target.role) <> target.role or coalesce(p_status, target.status) <> target.status then
    select * into target from public.admin_update_account(p_target_id, p_role, p_status);
  end if;
  insert into public.staff_notes(account_id, center_id, note)
    values(target.id, target.center_id, p_note)
    on conflict(account_id) do update set note = excluded.note, center_id = excluded.center_id, updated_at = now();
  insert into public.audit_logs(actor_id, center_id, target_type, target_id, action, after_state)
    values(auth.uid(), target.center_id, 'ACCOUNT', target.id::text, 'STAFF_NOTE_UPDATED', jsonb_build_object('note_length', length(p_note)));
  return next target;
end
$$;
revoke all on function public.admin_update_staff(uuid, public.app_role, public.account_status, text) from public, anon;
grant execute on function public.admin_update_staff(uuid, public.app_role, public.account_status, text) to authenticated;

commit;
