begin;

create unique index if not exists idx_operations_accounts_center on accounts(id, center_id);
create table if not exists operation_centers (
    center_id uuid primary key references centers(id),
    timezone text not null default 'Asia/Seoul'
);
create table if not exists operation_members (
    member_id uuid primary key,
    center_id uuid not null references centers(id),
    joined_on date,
    deleted_on date,
    version integer not null default 1 check(version > 0),
    unique(member_id, center_id),
    foreign key(member_id, center_id) references accounts(id, center_id),
    check(deleted_on is null or joined_on is null or deleted_on >= joined_on)
);
create table if not exists operation_products (
    id uuid primary key,
    center_id uuid not null references centers(id),
    name text not null,
    kind text not null check(kind in ('PERIOD','COUNT','TRIAL')),
    days integer not null check(days between 1 and 36500),
    count integer not null check(count >= 0),
    price bigint not null check(price between 0 and 9007199254740991),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    check(kind = 'PERIOD' or count > 0)
);
create table if not exists operation_passes (
    id uuid primary key,
    center_id uuid not null references centers(id),
    member_id uuid not null,
    product_id uuid not null,
    start_on date not null,
    end_on date not null check(end_on >= start_on),
    remaining integer check(remaining >= 0),
    status text not null check(status in ('ACTIVE','PAUSED','CANCELLED')),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    foreign key(member_id, center_id) references operation_members(member_id, center_id),
    foreign key(product_id, center_id) references operation_products(id, center_id)
);
create table if not exists operation_pass_history (
    id uuid primary key,
    center_id uuid not null references centers(id),
    pass_id uuid not null,
    action text not null check(action in ('ASSIGN','PAUSE','RESUME','EXTEND','CANCEL')),
    reason text not null,
    author_id uuid not null references accounts(id),
    at timestamptz not null,
    previous_end_on date,
    end_on date not null,
    foreign key(pass_id, center_id) references operation_passes(id, center_id)
);
create table if not exists operation_attendance (
    id uuid primary key,
    center_id uuid not null references centers(id),
    member_id uuid not null,
    visited_on date not null,
    status text not null check(status in ('PRESENT','CANCELLED')),
    reason text not null,
    created_at timestamptz not null,
    cancelled_at timestamptz,
    version integer not null default 1 check(version > 0),
    foreign key(member_id, center_id) references operation_members(member_id, center_id)
);
create unique index if not exists idx_operation_attendance_present
    on operation_attendance(center_id, member_id, visited_on) where status = 'PRESENT';
create table if not exists operation_payments (
    id uuid primary key,
    center_id uuid not null references centers(id),
    member_id uuid not null,
    product_id uuid not null,
    amount bigint not null check(amount between 1 and 9007199254740991),
    method text not null check(method in ('CARD','CASH','TRANSFER')),
    paid_on date,
    status text not null check(status in ('PAID','UNPAID','PARTIAL_REFUND','REFUNDED','CANCELLED')),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    foreign key(member_id, center_id) references operation_members(member_id, center_id),
    foreign key(product_id, center_id) references operation_products(id, center_id)
);
create table if not exists operation_adjustments (
    id uuid primary key,
    center_id uuid not null references centers(id),
    payment_id uuid not null,
    action text not null check(action in ('CANCEL','REFUND')),
    amount bigint not null check(amount between 0 and 9007199254740991),
    reason text not null,
    on_date date not null,
    author_id uuid not null references accounts(id),
    at timestamptz not null,
    foreign key(payment_id, center_id) references operation_payments(id, center_id)
);
create table if not exists operation_notes (
    id uuid primary key,
    center_id uuid not null references centers(id),
    member_id uuid not null,
    content text not null,
    author_id uuid not null references accounts(id),
    created_at timestamptz not null,
    foreign key(member_id, center_id) references operation_members(member_id, center_id)
);
create table if not exists operation_requests (
    actor_id uuid not null references accounts(id),
    request_id text not null,
    center_id uuid not null references centers(id),
    fingerprint text not null,
    result jsonb not null,
    created_at timestamptz not null,
    primary key(actor_id, request_id)
);
create table if not exists operation_audit (
    id uuid primary key,
    center_id uuid not null references centers(id),
    actor_id uuid not null references accounts(id),
    operation text not null,
    target_id text not null,
    before_state jsonb not null,
    after_state jsonb not null,
    created_at timestamptz not null
);
create index if not exists idx_operation_passes_member on operation_passes(center_id, member_id);
create index if not exists idx_operation_payments_member on operation_payments(center_id, member_id);
create index if not exists idx_operation_attendance_date on operation_attendance(center_id, visited_on);
create index if not exists idx_operation_notes_member on operation_notes(center_id, member_id);
create index if not exists idx_operation_audit_center on operation_audit(center_id, created_at);

alter table public.operation_centers enable row level security;
revoke all on public.operation_centers from public,anon,authenticated;
grant select on public.operation_centers to authenticated;
create policy operation_centers_read on public.operation_centers for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER'));

alter table public.operation_members enable row level security;
revoke all on public.operation_members from public,anon,authenticated;
grant select on public.operation_members to authenticated;
create policy operation_members_read on public.operation_members for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and (public.current_account_role()<>'MEMBER' or member_id=auth.uid()));

alter table public.operation_products enable row level security;
revoke all on public.operation_products from public,anon,authenticated;
grant select on public.operation_products to authenticated;
create policy operation_products_read on public.operation_products for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER'));

alter table public.operation_passes enable row level security;
revoke all on public.operation_passes from public,anon,authenticated;
grant select on public.operation_passes to authenticated;
create policy operation_passes_read on public.operation_passes for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and (public.current_account_role()<>'MEMBER' or member_id=auth.uid()));

alter table public.operation_pass_history enable row level security;
revoke all on public.operation_pass_history from public,anon,authenticated;
grant select on public.operation_pass_history to authenticated;
create policy operation_pass_history_read on public.operation_pass_history for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and exists(select 1 from public.operation_passes parent where parent.id=pass_id and parent.center_id=operation_pass_history.center_id));

alter table public.operation_attendance enable row level security;
revoke all on public.operation_attendance from public,anon,authenticated;
grant select on public.operation_attendance to authenticated;
create policy operation_attendance_read on public.operation_attendance for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and (public.current_account_role()<>'MEMBER' or member_id=auth.uid()));

alter table public.operation_payments enable row level security;
revoke all on public.operation_payments from public,anon,authenticated;
grant select on public.operation_payments to authenticated;
create policy operation_payments_read on public.operation_payments for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and (public.current_account_role()<>'MEMBER' or member_id=auth.uid()));

alter table public.operation_adjustments enable row level security;
revoke all on public.operation_adjustments from public,anon,authenticated;
grant select on public.operation_adjustments to authenticated;
create policy operation_adjustments_read on public.operation_adjustments for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH','MEMBER') and exists(select 1 from public.operation_payments parent where parent.id=payment_id and parent.center_id=operation_adjustments.center_id));

alter table public.operation_notes enable row level security;
revoke all on public.operation_notes from public,anon,authenticated;
grant select on public.operation_notes to authenticated;
create policy operation_notes_read on public.operation_notes for select to authenticated using (center_id=public.current_center_id() and public.current_account_role() in ('CENTER_OWNER','COACH'));

alter table public.operation_requests enable row level security;
revoke all on public.operation_requests from public,anon,authenticated;
grant select on public.operation_requests to authenticated;
create policy operation_requests_read on public.operation_requests for select to authenticated using (center_id=public.current_center_id() and actor_id=auth.uid() and public.current_account_role() in ('CENTER_OWNER','COACH'));

alter table public.operation_audit enable row level security;
revoke all on public.operation_audit from public,anon,authenticated;
grant select on public.operation_audit to authenticated;
create policy operation_audit_read on public.operation_audit for select to authenticated using (center_id=public.current_center_id() and public.current_account_role()='CENTER_OWNER');

insert into public.operation_centers(center_id) select id from public.centers on conflict do nothing;
insert into public.operation_members(member_id,center_id) select id,center_id from public.accounts where role='MEMBER' on conflict do nothing;

create function public.operations_actor()
returns public.accounts language plpgsql stable security definer set search_path=public,auth as $$
declare actor public.accounts%rowtype;
begin
  select * into actor from public.accounts where id=auth.uid() and public.account_is_active()
    and role in ('CENTER_OWNER','COACH','MEMBER');
  if actor.id is null then raise exception 'active operational account required' using errcode='42501'; end if;
  return actor;
end $$;
revoke all on function public.operations_actor() from public,anon;
grant execute on function public.operations_actor() to authenticated;

create function public.register_operational_member()
returns trigger language plpgsql security definer set search_path=public as $$
declare zone text;
begin
  if new.role='MEMBER' then
    select timezone into zone from public.operation_centers where center_id=new.center_id;
    insert into public.operation_members(member_id,center_id,joined_on)
      values(new.id,new.center_id,(now() at time zone coalesce(zone,'Asia/Seoul'))::date)
      on conflict(member_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.register_operational_member() from public,anon,authenticated;
create trigger register_operational_member after insert or update of role on public.accounts
  for each row execute function public.register_operational_member();

commit;

