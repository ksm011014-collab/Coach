import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    settings = dict(line.split('=', 1) for line in args.settings.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#') and '=' in line)
    hostname = urlparse(settings['BOXING_COACH_SUPABASE_URL']).hostname
    if not hostname or not hostname.endswith('.supabase.co'):
        raise ValueError('Invalid project hostname')
    reference = hostname.split('.')[0]
    token = settings.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not token:
        raise ValueError('Management token is missing')

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
        with urlopen(Request('https://api.supabase.com/v1/projects/' + reference + path, data=data, headers=headers), timeout=60) as response:
            return json.load(response)

    def query(sql, readonly=False):
        return request('/database/query', {'query': sql, 'read_only': readonly})

    project = request('')
    if project['name'] != 'boxingcoach-staging' or project['status'] != 'ACTIVE_HEALTHY':
        raise ValueError('Only the healthy boxingcoach-staging project is allowed')
    state = query("select (select count(*) from auth.users) as auth_users, (select count(*) from pg_tables where schemaname='public') as public_tables, to_regclass('supabase_migrations.schema_migrations')::text as history", True)[0]
    migrations = sorted((Path(__file__).resolve().parents[1] / 'supabase/migrations').glob('*.sql'))
    print(json.dumps({'project': project['name'], **state, 'local_migrations': len(migrations)}), flush=True)
    if not args.apply:
        return
    if not state['history']:
        if state['auth_users'] or state['public_tables']:
            raise ValueError('Untracked existing data requires review before initial deployment')
        query("create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text, source_hash text); revoke all on schema supabase_migrations from public,anon,authenticated; revoke all on all tables in schema supabase_migrations from public,anon,authenticated;")
    columns = query("select column_name from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'", True)
    if 'source_hash' not in {row['column_name'] for row in columns}:
        raise ValueError('Migration history was created by another tool; review hashes before deployment')
    applied = {row['version']: row for row in query('select version,source_hash from supabase_migrations.schema_migrations', True)}
    local_versions = {path.stem.split('_', 1)[0] for path in migrations}
    if set(applied) - local_versions:
        raise ValueError('Remote migrations are absent locally')
    for path in migrations:
        version, name = path.stem.split('_', 1)
        sql = path.read_text(encoding='utf-8').strip()
        digest = hashlib.sha256(sql.encode()).hexdigest()
        if version in applied:
            if applied[version]['source_hash'] != digest:
                raise ValueError('Previously deployed migration differs: ' + path.name)
            print('Already applied: ' + path.name, flush=True)
            continue
        if not sql.startswith('begin;') or not sql.endswith('commit;'):
            raise ValueError('Migration must have an explicit transaction: ' + path.name)
        statement = 'insert into supabase_migrations.schema_migrations(version,name,source_hash,statements) values(' + ','.join((quote(version), quote(name), quote(digest), 'array[' + quote(sql) + ']')) + ');'
        query(sql[:-len('commit;')] + '\n' + statement + '\ncommit;')
        print('Applied: ' + path.name, flush=True)
    result = query('select count(*) as migrations from supabase_migrations.schema_migrations', True)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
