from datetime import datetime, timedelta, timezone


def center_now(connection, center_id):
    row = connection.execute('select timezone from operation_centers where center_id=?', (center_id,)).fetchone()
    name = row['timezone'] if row else 'Asia/Seoul'
    if name == 'Asia/Seoul':
        zone = timezone(timedelta(hours=9))
    elif name == 'UTC':
        zone = timezone.utc
    else:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(name)
    return datetime.now(zone).isoformat()


SCHEMA = """
create table if not exists operation_center_details (
    id text primary key references gyms(id),
    center_id text not null unique references gyms(id),
    phone text not null default '',
    address text not null default '',
    weekday_hours text not null default '',
    weekend_hours text not null default '',
    version integer not null default 1 check(version > 0),
    check(id = center_id)
);
create unique index if not exists idx_users_center_identity on users(id, gym_id);
create table if not exists operation_centers (
    center_id text primary key references gyms(id),
    timezone text not null default 'Asia/Seoul'
);
create table if not exists operation_members (
    member_id text primary key,
    center_id text not null references gyms(id),
    joined_on text,
    deleted_on text,
    version integer not null default 1 check(version > 0),
    unique(member_id, center_id),
    foreign key(member_id, center_id) references users(id, gym_id),
    check(deleted_on is null or joined_on is null or deleted_on >= joined_on)
);
create table if not exists operation_products (
    id text primary key,
    center_id text not null references gyms(id),
    name text not null,
    kind text not null check(kind in ('PERIOD','COUNT','TRIAL')),
    days integer not null check(days between 1 and 36500),
    count integer not null check(count >= 0),
    price integer not null check(price between 0 and 9007199254740991),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    check(kind = 'PERIOD' or count > 0)
);
create table if not exists operation_passes (
    id text primary key,
    center_id text not null references gyms(id),
    member_id text not null,
    product_id text not null,
    start_on text not null,
    end_on text not null check(end_on >= start_on),
    remaining integer check(remaining >= 0),
    status text not null check(status in ('ACTIVE','PAUSED','CANCELLED')),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    foreign key(member_id, center_id) references operation_members(member_id, center_id),
    foreign key(product_id, center_id) references operation_products(id, center_id)
);
create table if not exists operation_pass_history (
    id text primary key,
    center_id text not null references gyms(id),
    pass_id text not null,
    action text not null check(action in ('ASSIGN','PAUSE','RESUME','EXTEND','CANCEL','SET_END')),
    reason text not null,
    author_id text not null references users(id),
    at text not null,
    previous_end_on text,
    end_on text not null,
    foreign key(pass_id, center_id) references operation_passes(id, center_id)
);
create table if not exists operation_attendance (
    id text primary key,
    center_id text not null references gyms(id),
    member_id text not null,
    visited_on text not null,
    status text not null check(status in ('PRESENT','CANCELLED')),
    reason text not null,
    created_at text not null,
    cancelled_at text,
    version integer not null default 1 check(version > 0),
    foreign key(member_id, center_id) references operation_members(member_id, center_id)
);
create unique index if not exists idx_operation_attendance_present
    on operation_attendance(center_id, member_id, visited_on) where status = 'PRESENT';
create table if not exists operation_payments (
    id text primary key,
    center_id text not null references gyms(id),
    member_id text not null,
    product_id text not null,
    amount integer not null check(amount between 1 and 9007199254740991),
    method text not null check(method in ('CARD','CASH','TRANSFER','KAKAOPAY','EASY_PAY')),
    paid_on text,
    status text not null check(status in ('PAID','UNPAID','PARTIAL_REFUND','REFUNDED','CANCELLED')),
    version integer not null default 1 check(version > 0),
    unique(id, center_id),
    foreign key(member_id, center_id) references operation_members(member_id, center_id),
    foreign key(product_id, center_id) references operation_products(id, center_id)
);
create table if not exists operation_adjustments (
    id text primary key,
    center_id text not null references gyms(id),
    payment_id text not null,
    action text not null check(action in ('CANCEL','REFUND')),
    amount integer not null check(amount between 0 and 9007199254740991),
    reason text not null,
    on_date text not null,
    author_id text not null references users(id),
    at text not null,
    foreign key(payment_id, center_id) references operation_payments(id, center_id)
);
create table if not exists operation_notes (
    id text primary key,
    center_id text not null references gyms(id),
    member_id text not null,
    content text not null,
    author_id text not null references users(id),
    created_at text not null,
    foreign key(member_id, center_id) references operation_members(member_id, center_id)
);
create table if not exists operation_requests (
    actor_id text not null references users(id),
    request_id text not null,
    center_id text not null references gyms(id),
    fingerprint text not null,
    result text not null,
    created_at text not null,
    primary key(actor_id, request_id)
);
create table if not exists operation_audit (
    id text primary key,
    center_id text not null references gyms(id),
    actor_id text not null references users(id),
    operation text not null,
    target_id text not null,
    before_state text not null,
    after_state text not null,
    created_at text not null
);
create index if not exists idx_operation_passes_member on operation_passes(center_id, member_id);
create index if not exists idx_operation_payments_member on operation_payments(center_id, member_id);
create index if not exists idx_operation_attendance_date on operation_attendance(center_id, visited_on);
create index if not exists idx_operation_notes_member on operation_notes(center_id, member_id);
create index if not exists idx_operation_audit_center on operation_audit(center_id, created_at);
"""


def install_operations_schema(connection):
    for table, marker in [('operation_pass_history', 'SET_END'), ('operation_payments', 'KAKAOPAY')]:
        existing = connection.execute('select sql from sqlite_master where type=? and name=?', ('table', table)).fetchone()
        if existing and marker not in existing['sql']:
            if connection.execute('pragma foreign_keys').fetchone()[0]:
                raise ValueError('Stop the worker and use the explicit offline migration tool')
            definition = next(statement.strip() for statement in SCHEMA.split(';') if statement.strip().startswith('create table if not exists ' + table + ' ('))
            connection.execute(definition.replace('create table if not exists ' + table, 'create table ' + table + '_upgrade', 1))
            columns = ','.join('"' + row['name'] + '"' for row in connection.execute('pragma table_info(' + table + ')'))
            connection.execute('insert into ' + table + '_upgrade (' + columns + ') select ' + columns + ' from ' + table)
            connection.execute('drop table ' + table)
            connection.execute('alter table ' + table + '_upgrade rename to ' + table)
    for statement in SCHEMA.split(';'):
        if statement.strip():
            connection.execute(statement)
    connection.execute('insert or ignore into operation_centers(center_id) select id from gyms')
    connection.execute("""insert or ignore into operation_members(member_id, center_id)
        select id, gym_id from users where role = 'MEMBER'""")
