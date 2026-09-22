import assert from 'node:assert/strict';

export async function verifyMotionRounds(db, asUser, id) {
  const session = id(80);
  const report = {version:1,status:'experimental',algorithm:'rules-v1',stance:'orthodox',duration_ms:2000,
    total_points:999,events:[{id:'punch-1',label:'jab',hand:'left',start_ms:300,end_ms:900,quality:75,confidence:0.9,points:999}]};
  const rpc = 'select * from finish_motion_round($1,$2::jsonb)';
  await db.query("insert into training_sessions(id,user_id,center_id,started_at) values($1,$2,$3,now()-interval '10 seconds')", [session,id(13),id(1)]);
  try {
    for (const actor of [11,12,13]) {
      const result = (await asUser(id(actor),rpc,[session,JSON.stringify(report)])).rows[0];
      assert.equal(result.feedback_report.total_points,8);
      assert.equal(result.overall_score,75);
      assert.ok(result.ended_at);
    }
    for (const [actor,code] of [[10,'42501'],[14,'P0002'],[15,'P0002'],[16,'P0002']]) {
      await assert.rejects(asUser(id(actor),rpc,[session,JSON.stringify(report)]),{code});
    }
    await assert.rejects(asUser(id(13),rpc,[session,JSON.stringify(report)],false,999),{code:'42501'});
    await assert.rejects(asUser(id(13),'select normalize_motion_report($1)',[JSON.stringify(report)]),{code:'42501'});
    await assert.rejects(asUser(id(13),'update training_sessions set overall_score=99 where id=$1',[session]),{code:'42501'});
    const event = report.events[0];
    const tracking = {gaps:[{start_ms:0,end_ms:100,reason:'no_result'}],total_ms:100,truncated:false};
    assert.deepEqual((await asUser(id(13),rpc,[session,JSON.stringify({...report,tracking})])).rows[0].feedback_report.tracking,tracking);
    for (const invalid of [{...tracking,total_ms:99},{...tracking,truncated:true},{...tracking,gaps:[...tracking.gaps,...tracking.gaps]},{...tracking,gaps:[{start_ms:0,end_ms:2001,reason:'no_result'}]}]) {
      await assert.rejects(asUser(id(13),rpc,[session,JSON.stringify({...report,tracking:invalid})]),{code:'22023'});
    }
    for (const guard_ratio of [0,0.25,1]) {
      const evidenceReport = {...report,events:[{...event,guard_ratio}]};
      assert.equal((await asUser(id(13),rpc,[session,JSON.stringify(evidenceReport)])).rows[0].feedback_report.events[0].guard_ratio,guard_ratio);
    }
    for (const guard_ratio of [null,true,'0.5',-0.1,1.1]) {
      await assert.rejects(asUser(id(13),rpc,[session,JSON.stringify({...report,events:[{...event,guard_ratio}]})]),{code:'22023'});
    }
    for (const invalid of [
      {...report,duration_ms:3600001}, {...report,status:'unavailable'},
      {...report,events:[event,event]}, {...report,events:[{...event,hand:'right'}]},
      {...report,events:[{...event,quality:101}]}, {...report,events:[{...event,confidence:0.64}]},
      {...report,events:[{...event,end_ms:2001}]}, {...report,events:[{...event,start_ms:0.5}]},
      {...report,events:[event,{...event,id:'overlap',label:'hook',start_ms:700,end_ms:1000}]},
    ]) {
      await assert.rejects(asUser(id(13),rpc,[session,JSON.stringify(invalid)]),{code:'22023'});
    }
    const paired = {...report,events:[event,{...event,id:'opposite',label:'hook',hand:'right',start_ms:700,end_ms:1000}]};
    assert.equal((await asUser(id(13),rpc,[session,JSON.stringify(paired)])).rows[0].feedback_report.total_points,16);
    const unavailable = {...report,status:'unavailable',events:[]};
    assert.equal((await asUser(id(13),rpc,[session,JSON.stringify(unavailable)])).rows[0].feedback_report.mean_quality,null);
    const first = (await asUser(id(13),rpc,[session,JSON.stringify(report)],true)).rows[0];
    const retry = (await asUser(id(13),rpc,[session,JSON.stringify(report)],true)).rows[0];
    assert.deepEqual(retry,first);
    await assert.rejects(asUser(id(13),rpc,[session,JSON.stringify(unavailable)]),{code:'23505'});
    assert.equal((await db.query("select id from operation_audit where operation='round.finish' and target_id=$1",[session])).rows.length,1);
    assert.equal((await asUser(id(15),'select id from training_sessions where id=$1',[session])).rows.length,0);
    assert.equal((await asUser(id(13),'select feedback_report from training_sessions where id=$1',[session])).rows[0].feedback_report.total_points,8);
  } finally {
    await db.query("delete from operation_audit where operation='round.finish' and target_id=$1",[session]);
    await db.query('delete from training_sessions where id=$1',[session]);
  }
}
