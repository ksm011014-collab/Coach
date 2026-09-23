import assert from 'node:assert/strict';

export async function verifyCoachService(db, asUser, id) {
  const modelSql='select platform_set_coach_model($1,$2,$3,$4)';
  await assert.rejects(asUser(id(11),modelSql,['test-model','Test model',true,true]),{code:'42501'});
  await asUser(id(10),modelSql,['test-model','Test model',true,true],true);
  assert.equal((await asUser(id(13),'select model_id from coach_models')).rows[0].model_id,'test-model');
  await assert.rejects(asUser(id(13),"insert into coach_models values('unapproved','Unapproved',true,false)"),{code:'42501'});
  for (const [n,user,center] of [[801,13,1],[802,15,2],[803,14,1]]) {
    await db.query("insert into training_sessions(id,user_id,center_id,started_at,ended_at) values($1,$2,$3,now()-interval '1 minute',now())",[id(n),id(user),id(center)]);
  }
  const prepare='select coach_prepare($1,$2,$3,$4) as result';
  const args=[id(810),id(801),'test-model','a'.repeat(64)];
  for (const actor of [10,14,15,16]) await assert.rejects(asUser(id(actor),prepare,args),{code:'42501'});
  await assert.rejects(asUser(id(13),prepare,[id(810),id(801),'unapproved','a'.repeat(64)]),{code:'42501'});
  const first=(await asUser(id(13),prepare,args,true)).rows[0].result;
  assert.equal(first.duplicate,false);
  assert.equal(first.actor_id,id(13));
  assert.equal(first.session.user_id,undefined);
  assert.equal((await asUser(id(13),prepare,args)).rows[0].result.duplicate,true);
  await assert.rejects(asUser(id(13),prepare,[...args.slice(0,3),'b'.repeat(64)]),{code:'23505'});
  for(const actor of [11,12]) assert.equal((await asUser(id(actor),prepare,[id(810),id(803),'test-model','a'.repeat(64)])).rows[0].result.duplicate,false);
  const complete='select coach_complete($1,$2,$3,$4,$5,$6)';
  for(const actor of [10,11,12,13]) await assert.rejects(asUser(id(actor),complete,[id(13),id(810),'completed',10,5,15]),{code:'42501'});
  await db.exec('set role service_role');
  await db.query(complete,[id(13),id(810),'completed',10,5,15]);
  await db.exec('reset role');
  for (const [actor,expected] of [[10,15],[11,15],[12,15],[13,15],[14,null],[15,null],[16,null]]) {
    const usage=(await asUser(id(actor),'select coach_usage() as result')).rows[0].result;
    assert.equal(usage.total_tokens,expected);
    assert.equal(usage.timezone,'UTC');
  }
  await assert.rejects(asUser(id(13),'select fingerprint from coach_requests'),{code:'42501'});
  await assert.rejects(asUser(id(13),"update coach_requests set input_tokens=0"),{code:'42501'});
  await asUser(id(13),prepare,[id(811),id(801),'test-model','a'.repeat(64)],true);
  const usage=(await asUser(id(13),'select coach_usage() as result')).rows[0].result;
  assert.equal(usage.measured_requests,1);
  assert.equal(usage.unmeasured_requests,1);
  assert.equal(usage.total_tokens,15);
  for(let n=812;n<816;n++) await asUser(id(13),prepare,[id(n),id(801),'test-model','a'.repeat(64)],true);
  await assert.rejects(asUser(id(13),prepare,[id(816),id(801),'test-model','a'.repeat(64)]),{code:'P0001'});
  await db.query("update accounts set status='SUSPENDED' where id=$1",[id(13)]);
  await assert.rejects(asUser(id(13),prepare,args),{code:'42501'});
  await assert.rejects(asUser(id(13),'select coach_usage()'),{code:'42501'});
  await db.query("update accounts set status='ACTIVE' where id=$1",[id(13)]);
  await db.query('delete from training_sessions where id=$1',[id(801)]);
  assert.equal((await db.query('select session_id from coach_requests limit 1')).rows[0].session_id,null);
  assert.equal((await asUser(id(11),'select coach_usage() as result')).rows[0].result.total_tokens,15);
  // Keep the remaining suite's fixtures independent.
  await db.exec("delete from coach_requests; delete from training_sessions where id in ('"+[801,802,803].map(id).join("','")+"')");
}
