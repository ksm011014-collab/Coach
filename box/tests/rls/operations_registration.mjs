import assert from 'node:assert/strict';

export async function verifyOperationsRegistration(db, asUser, id) {
  const product = (await asUser(id(11),'select operations_mutate($1,$2::jsonb,$3) as result', ['product.save',JSON.stringify({name:'Registration product',kind:'COUNT',days:30,count:10,price:100}),'registration-product'],true)).rows[0].result;
  const input = {username:'registrationtest',name:'Synthetic registration',product_id:product.id,phone:'010-0000-0000'};
  const prepare = async (values, key, signature='a'.repeat(64), actor=11) => (await asUser(id(actor),'select operations_registration_prepare($1::jsonb,$2,$3) as result',[JSON.stringify(values),key,signature],true)).rows[0].result;
  const prepared = await prepare(input,'register-retry');
  assert.ok(prepared.nonce);
  assert.deepEqual(await prepare(input,'register-retry'),prepared);
  await assert.rejects(prepare({...input,name:'Changed'},'register-retry'),{code:'23505'});
  await assert.rejects(prepare(input,'register-retry','b'.repeat(64)),{code:'23505'});
  await assert.rejects(prepare(input,'register-coach','a'.repeat(64),12),{code:'42501'});
  await assert.rejects(asUser(id(11),'select operations_mutate($1,$2::jsonb,$3)', ['product.save',JSON.stringify({name:'Wrong key',kind:'PERIOD',days:30,count:0,price:0}),'register-retry'],true),{code:'23505'});
  await asUser(id(11),'select operations_mutate($1,$2::jsonb,$3)', ['product.save',JSON.stringify({...product,count:20,days:60}),'registration-product-change'],true);
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',[id(601),JSON.stringify({username:input.username,provisioning_nonce:prepared.nonce})]);
  const completed = await prepare(input,'register-retry');
  assert.equal(completed.result.id,id(601));
  assert.equal(completed.result.pass.remaining,10);
  assert.equal(completed.result.version,1);
  assert.equal((await db.query('select count(*)::int as total from accounts where username=$1',[input.username])).rows[0].total,1);
  await assert.rejects(prepare({...input,height_cm:99999},'register-fail'),{code:'22023'});
  await assert.rejects(prepare({...input,stance:'invalid'},'register-fail'),{code:'22023'});
  const invalid = {...input,username:'registrationfail'};
  const failed = await prepare(invalid,'register-fail');
  await db.exec('begin');
  try {
    await db.query("update accounts set status='SUSPENDED' where id=$1",[id(11)]);
    await assert.rejects(db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)',[id(602),JSON.stringify({username:invalid.username,provisioning_nonce:failed.nonce})]));
  } finally { await db.exec('rollback'); }
  assert.equal((await db.query('select id from accounts where id=$1',[id(602)])).rows.length,0);
  assert.equal((await db.query('select id from member_profiles where user_id=$1',[id(602)])).rows.length,0);
  assert.equal((await db.query('select id from operation_passes where member_id=$1',[id(602)])).rows.length,0);
  assert.deepEqual(await prepare(invalid,'register-fail'),failed);
  for (const table of ['audit','requests','registrations','pass_history','passes','products']) await db.exec(`delete from operation_${table}`);
  await db.query('delete from account_provisioning where nonce=$1',[failed.nonce]);
  await db.query('delete from operation_members where member_id=$1',[id(601)]);
  await db.query('delete from account_audit_logs where target_id=$1',[id(601)]);
  await db.query('delete from auth.users where id=$1',[id(601)]);
}
