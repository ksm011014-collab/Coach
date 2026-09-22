import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { verifyOperationsPolicies } from './operations_policies.mjs';
import { verifyOperationsRpc } from './operations_rpc.mjs';
import { verifyOperationsRegistration } from './operations_registration.mjs';
import { verifyMotionRounds } from './motion_rounds.mjs';

// Supabase's auth schema is external to repository migrations. Only its SQL
// identity boundary is simulated here; GoTrue/PostgREST are separate staging gates.
const db = new PGlite({ extensions: { citext, pgcrypto } });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function asUser(user, sql, params = [], persist = false, tokenVersion = 1) {
  await db.exec('begin; set local role authenticated');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: user, app_token_version: tokenVersion})]);
    const result = await db.query(sql, params);
    if (persist) await db.exec('commit');
    return result;
  } finally {
    await db.exec('rollback');
  }
}
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role, supabase_auth_admin;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
  `);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
  // Fixture setup alone runs as database owner. All checks below use authenticated.
  await db.exec('alter table auth.users disable trigger user');
  for (const n of [1, 2]) {
    await db.query('insert into centers(id,name,code) values($1,$2,$3)', [id(n), `Synthetic ${n}`, `test_${n}`]);
  }
  const actors = [
    [10, 1, 'PLATFORM_ADMIN'], [11, 1, 'CENTER_OWNER'], [12, 1, 'COACH'],
    [13, 1, 'MEMBER'], [14, 1, 'MEMBER'], [15, 2, 'MEMBER'], [16, 2, 'CENTER_OWNER'],
  ];
  for (const [n, center, role] of actors) {
    await db.query('insert into auth.users(id) values($1)', [id(n)]);
    await db.query('insert into accounts(id,center_id,username,display_name,role) values($1,$2,$3,$4,$5)',
      [id(n), id(center), `test_${n}`, `Synthetic ${n}`, role]);
  }
  await db.exec('alter table auth.users enable trigger user');
  const flagSql="select * from platform_set_feature_flag($1,'web.beta',true,'{}','BETA')";
  await asUser(id(10),flagSql,[id(1)],true);
  assert.equal((await asUser(id(13),'select flag_key from feature_flags')).rows.length,1);
  assert.equal((await asUser(id(15),'select flag_key from feature_flags')).rows.length,0);
  await assert.rejects(asUser(id(11),flagSql,[id(1)]),{code:'42501'});
  assert.equal((await db.query("select id from audit_logs where target_type='FEATURE_FLAG'")).rows.length,1);
  for (const [n,user,center] of [[40,13,1],[41,15,2],[42,10,1]]) {
    await db.query('insert into member_profiles(id,user_id,center_id,name) values($1,$2,$3,$4)',
      [id(n),id(user),id(center),'Synthetic profile']);
  }
  const patchSql='select * from update_member_profile($1,$2::jsonb)';
  await verifyOperationsPolicies(db, asUser, id);
  await verifyOperationsRpc(db, asUser, id);
  await verifyOperationsRegistration(db, asUser, id);
  await verifyMotionRounds(db, asUser, id);
  for (const actor of [11,12,13]) {
    assert.equal((await asUser(id(actor),patchSql,[id(40),JSON.stringify({phone:'123'})])).rows[0].phone,'123');
  }
  for (const [actor,profile] of [[10,40],[10,42],[13,41],[16,40]]) {
    await assert.rejects(asUser(id(actor),patchSql,[id(profile),'{}']),{code:'42501'});
  }
  await assert.rejects(asUser(id(13),patchSql,[id(40),'{"reach_cm":180}']),{code:'42501'});
  for(const patch of ['[]','{"name":" "}','{"height_cm":true}','{"phone":null}']) {
    await assert.rejects(asUser(id(11),patchSql,[id(40),patch]),{code:'22023'});
  }
  assert.equal((await asUser(id(12),patchSql,[id(40),'{"reach_cm":180,"training_level":3}'])).rows[0].reach_cm,180);
  for (const [n, user, center] of [[20, 13, 1], [21, 14, 1], [22, 15, 2]]) {
    await db.query('insert into training_sessions(id,user_id,center_id) values($1,$2,$3)', [id(n), id(user), id(center)]);
  }
  for (const [actor, count] of [[10, 3], [11, 2], [12, 2], [13, 1], [16, 1]]) {
    const result = await asUser(id(actor), 'select id from training_sessions');
    assert.equal(result.rows.length, count, `read scope for ${actor}`);
  }
  for (const actor of [11, 12, 13]) {
    const result = await asUser(id(actor), 'update training_sessions set ended_at=now() where id=$1 returning id', [id(20)]);
    assert.equal(result.rows.length, 1, `same-center/self allowed ${actor}`);
  }
  for (const actor of [10, 14, 15, 16]) {
    const result = await asUser(id(actor), 'update training_sessions set ended_at=now() where id=$1 returning id', [id(20)]);
    assert.equal(result.rows.length, 0, `mutation denied ${actor}`);
  }
  await assert.rejects(asUser(id(11),
    'insert into training_sessions(user_id,center_id) values($1,$2)', [id(15), id(1)]),
    'a center owner must not attach another center\'s member to their session');
  for (const actor of [11, 12, 13]) {
    const result = await asUser(id(actor),
      'insert into training_sessions(user_id,center_id) values($1,$2) returning id', [id(13), id(1)]);
    assert.equal(result.rows.length, 1, `valid session insert ${actor}`);
  }
  await assert.rejects(asUser(id(10),
    'insert into training_sessions(user_id,center_id) values($1,$2)', [id(10), id(1)]),
    { code: '42501' });
  await assert.rejects(asUser(id(11),
    'update training_sessions set user_id=$1 where id=$2', [id(14), id(20)]),
    { code: '23514' });
  const label = await asUser(id(12),
    'insert into coach_labels(session_id,owner_id,center_id,label) values($1,$2,$3,$4) returning id',
    [id(20), id(12), id(1), 'manual coach note']);
  assert.equal(label.rows.length, 1);
  await assert.rejects(asUser(id(12),
    'insert into coach_labels(session_id,owner_id,center_id,label) values($1,$2,$3,$4)',
    [id(22), id(12), id(1), 'wrong center']), { code: '23503' });
  await assert.rejects(asUser(id(13),
    'select public.save_member_calibration($1,$2::jsonb)', [id(20), '{}']), { code: '42501' });
  const startSql = 'select * from public.start_training_session($1,$2::jsonb,$3,$4)';
  const startArgs = [id(13), '[]', 'free_training', 'repeatable-request'];
  const first = (await asUser(id(13), startSql, startArgs, true)).rows[0];
  const replay = (await asUser(id(13), startSql, startArgs, true)).rows[0];
  assert.equal(replay.id, first.id);
  assert.equal(replay.started_at.getTime(), first.started_at.getTime());
  await assert.rejects(asUser(id(13), startSql, [id(13), '[]', 'changed', startArgs[3]]), {code:'23505'});
  const endSql = 'select * from public.end_training_session($1)';
  const ended = (await asUser(id(13), endSql, [first.id], true)).rows[0];
  const endedAgain = (await asUser(id(13), endSql, [first.id], true)).rows[0];
  assert.equal(endedAgain.ended_at.getTime(), ended.ended_at.getTime());
  assert.equal((await asUser(id(16), endSql, [first.id])).rows.length, 0);
  await assert.rejects(asUser(id(13), startSql, [id(15), '[]', 'free_training', 'cross-center']), {code:'42501'});
  await assert.rejects(asUser(id(13),
    'insert into training_sessions(user_id,center_id,overall_score) values($1,$2,99)', [id(13),id(1)]), {code:'23514'});
  // A signed claim must match current DB state; neither missing nor string
  // versions are accepted. Tests simulate verified JWT claims at the DB edge.
  for (const version of [null, '1', 0, 99]) {
    assert.equal((await asUser(id(14), 'select id from training_sessions', [], false, version)).rows.length, 0);
  }
  await asUser(id(11), "select * from public.admin_update_account($1,'COACH',null)", [id(14)], true);
  assert.equal((await asUser(id(14), 'select id from training_sessions')).rows.length, 0);
  assert.ok((await asUser(id(14), 'select id from training_sessions', [], false, 2)).rows.length > 0);
  await assert.rejects(asUser(id(14), 'select public.custom_access_token_hook($1::jsonb)',
    [JSON.stringify({user_id:id(14),claims:{}})]), {code:'42501'});
  await db.exec('begin; set local role supabase_auth_admin');
  try {
    const hooked = await db.query('select public.custom_access_token_hook($1::jsonb) as result',
      [JSON.stringify({user_id:id(14),claims:{sub:id(14),role:'authenticated',app_token_version:999,user_metadata:{app_token_version:999}}})]);
    assert.equal(hooked.rows[0].result.claims.app_token_version, 2);
    assert.equal(hooked.rows[0].result.claims.sub, id(14));
    assert.equal(hooked.rows[0].result.claims.role, 'authenticated');
  } finally { await db.exec('rollback'); }
  await db.query('update accounts set token_version=token_version+1 where id=$1', [id(10)]);
  await assert.rejects(asUser(id(10), 'select public.require_platform_admin()'), {code:'42501'});
  assert.equal((await asUser(id(10), 'select public.require_platform_admin()', [], false, 2)).rows.length, 1);
  await db.query("update accounts set status='SUSPENDED' where id=$1", [id(13)]);
  await assert.rejects(asUser(id(12),'insert into training_sessions(user_id,center_id) values($1,$2)',[id(13),id(1)]),{code:'42501'});
  assert.equal((await asUser(id(13), 'select id from training_sessions')).rows.length, 0);
  await assert.rejects(asUser(id(13),
    'insert into training_sessions(user_id,center_id) values($1,$2)', [id(13), id(1)]),
    { code: '42501' });
  // Exercise actual auth.users triggers (the database part of GoTrue signup).
  await db.query('update center_subscriptions set max_members=2 where center_id=$1', [id(1)]);
  const signup = (n, centerCode) => db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',
    [id(n), JSON.stringify({username:`signup_${n}`,role:'MEMBER',center_code:centerCode})]);
  await signup(30, 'test_1');
  await assert.rejects(signup(31, 'test_1'), {code:'23514'});
  assert.equal((await db.query('select id from auth.users where id=$1', [id(31)])).rows.length, 0,
    'capacity rejection rolls back auth user as well as account/profile');
  assert.equal((await db.query("select id from accounts where center_id=$1 and role='MEMBER'", [id(1)])).rows.length, 2,
    'suspended member still consumes a slot');
  await db.query('update center_subscriptions set max_members=1 where center_id=$1', [id(2)]);
  await assert.rejects(asUser(id(10), "select * from admin_update_account($1,'MEMBER',null)", [id(16)], false, 2), {code:'23514'});
  await db.query("update centers set status='SUSPENDED' where id=$1", [id(2)]);
  await assert.rejects(signup(32, 'test_2'), {code:'42501'});
  const provisionSql = `insert into account_provisioning(username,display_name,role,center_id,created_by,creator_token_version)
    values($1::text,$1::text,'COACH',$2,$3,$4) returning nonce`;
  await assert.rejects(db.query(provisionSql, ['cross_coach',id(2),id(11),1]), {code:'42501'});
  const provision = (await db.query(provisionSql, ['valid_coach',id(1),id(11),1])).rows[0];
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',
    [id(33),JSON.stringify({username:'valid_coach',provisioning_nonce:provision.nonce})]);
  assert.equal((await db.query('select id from accounts where id=$1 and role=$2', [id(33),'COACH'])).rows.length,1);
  assert.equal((await db.query('select nonce from account_provisioning where nonce=$1', [provision.nonce])).rows.length,0);
  const creationAudit = (await db.query("select after_state from account_audit_logs where target_id=$1 and action='ACCOUNT_CREATED'",[id(33)])).rows;
  assert.equal(creationAudit.length,1);
  assert.deepEqual(Object.keys(creationAudit[0].after_state).sort(),['role','status','token_version']);
  const stale = (await db.query(provisionSql, ['stale_coach',id(1),id(11),1])).rows[0];
  await db.query('update accounts set token_version=token_version+1 where id=$1',[id(11)]);
  await assert.rejects(db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',
    [id(34),JSON.stringify({username:'stale_coach',provisioning_nonce:stale.nonce})]), {code:'42501'});
  assert.equal((await db.query('select id from accounts where id=$1',[id(34)])).rows.length,0);
  await asUser(id(12),'select public.revoke_own_access_tokens()',[],true);
  assert.equal((await asUser(id(12),'select id from training_sessions')).rows.length,0);
  await asUser(id(12),'select public.revoke_own_access_tokens()',[],true);
  assert.equal((await db.query('select token_version from accounts where id=$1',[id(12)])).rows[0].token_version,2,
    'repeated logout from stale token cannot revoke newer sessions');
  const before = await db.query('select * from training_sessions order by id');
  await db.exec(await readFile(new URL('202609160001_owned_record_integrity.sql', migrations), 'utf8'));
  assert.deepEqual((await db.query('select * from training_sessions order by id')).rows, before.rows,
    'migration rerun preserves record count and all representative session fields');
  console.log('PostgreSQL role and session isolation tests passed');
} finally {
  await db.close();
}
