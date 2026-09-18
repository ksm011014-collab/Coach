begin;

-- Existing rows remain intact. NOT VALID checks new writes immediately; a
-- separate staged audit/repair must precede VALIDATE CONSTRAINT on legacy data.
create unique index if not exists accounts_id_center_unique on public.accounts(id, center_id);
create unique index if not exists sessions_id_center_unique on public.training_sessions(id, center_id);
do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.member_profiles'::regclass and conname='profiles_account_center_fk') then
    alter table public.member_profiles add constraint profiles_account_center_fk
      foreign key(user_id, center_id) references public.accounts(id, center_id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.training_sessions'::regclass and conname='sessions_account_center_fk') then
    alter table public.training_sessions add constraint sessions_account_center_fk
      foreign key(user_id, center_id) references public.accounts(id, center_id) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.coach_labels'::regclass and conname='labels_session_center_fk') then
    alter table public.coach_labels add constraint labels_session_center_fk
      foreign key(session_id, center_id) references public.training_sessions(id, center_id) on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.coach_labels'::regclass and conname='labels_owner_center_fk') then
    alter table public.coach_labels add constraint labels_owner_center_fk
      foreign key(owner_id, center_id) references public.accounts(id, center_id) not valid;
  end if;
end
$$;

create or replace function public.preserve_training_ownership()
returns trigger language plpgsql set search_path=public as $$
begin
  if (new.id, new.user_id, new.center_id) is distinct from (old.id, old.user_id, old.center_id) then
    raise exception 'training record ownership is immutable' using errcode='23514';
  end if;
  return new;
end
$$;
drop trigger if exists preserve_session_ownership on public.training_sessions;
create trigger preserve_session_ownership before update on public.training_sessions
  for each row execute function public.preserve_training_ownership();
drop trigger if exists preserve_profile_ownership on public.member_profiles;
create trigger preserve_profile_ownership before update on public.member_profiles
  for each row execute function public.preserve_training_ownership();

-- Platform accounts retain operational visibility, without a self-ownership
-- exception that grants training mutation rights.
drop policy if exists sessions_insert on public.training_sessions;
create policy sessions_insert on public.training_sessions for insert to authenticated with check (
  public.account_is_active() and center_id=public.current_center_id()
  and exists(select 1 from public.accounts target where target.id=training_sessions.user_id
    and target.center_id=training_sessions.center_id and target.status='ACTIVE') and (
    public.current_account_role() in ('CENTER_OWNER','COACH')
    or (public.current_account_role()='MEMBER' and user_id=auth.uid())
  )
);
drop policy if exists sessions_update on public.training_sessions;
create policy sessions_update on public.training_sessions for update to authenticated using (
  public.account_is_active() and center_id=public.current_center_id() and (
    public.current_account_role() in ('CENTER_OWNER','COACH')
    or (public.current_account_role()='MEMBER' and user_id=auth.uid())
  )
) with check (
  public.account_is_active() and center_id=public.current_center_id() and (
    public.current_account_role() in ('CENTER_OWNER','COACH')
    or (public.current_account_role()='MEMBER' and user_id=auth.uid())
  )
);
drop policy if exists sessions_delete on public.training_sessions;
create policy sessions_delete on public.training_sessions for delete to authenticated using (
  public.account_is_active() and center_id=public.current_center_id() and (
    public.current_account_role() in ('CENTER_OWNER','COACH')
    or (public.current_account_role()='MEMBER' and user_id=auth.uid())
  )
);

-- Analysis removal must also close the old callable RPC; retain all tables/data.
revoke all on function public.save_member_calibration(uuid,jsonb) from public, anon, authenticated;
revoke insert, update, delete on public.member_calibrations from anon, authenticated;
commit;
