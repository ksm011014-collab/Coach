import assert from 'node:assert/strict';

export async function verifyOperationsPolicies(db, asUser, id) {
  await db.query(`insert into operation_products(id,center_id,name,kind,days,count,price)
    values($1,$2,'Synthetic product','PERIOD',30,0,10000)`, [id(501), id(1)]);
  await db.query(`insert into operation_passes(id,center_id,member_id,product_id,start_on,end_on,status)
    values($1,$2,$3,$4,current_date,current_date+30,'ACTIVE')`, [id(502), id(1), id(13), id(501)]);
  await db.query(`insert into operation_pass_history(id,center_id,pass_id,action,reason,author_id,at,end_on)
    values($1,$2,$3,'ASSIGN','Synthetic',$4,now(),current_date+30)`, [id(503), id(1), id(502), id(11)]);
  await db.query(`insert into operation_notes(id,center_id,member_id,content,author_id,created_at)
    values($1,$2,$3,'Staff only',$4,now())`, [id(504), id(1), id(13), id(12)]);
  for (const [actor, expected] of [[11,1],[12,1],[13,1],[14,0],[15,0],[16,0],[10,0]]) {
    assert.equal((await asUser(id(actor),'select id from operation_passes')).rows.length, expected, `pass read ${actor}`);
    assert.equal((await asUser(id(actor),'select id from operation_pass_history')).rows.length, expected, `history read ${actor}`);
  }
  for (const [actor, expected] of [[11,1],[12,1],[13,0],[14,0],[15,0],[16,0],[10,0]]) {
    assert.equal((await asUser(id(actor),'select id from operation_notes')).rows.length, expected, `note read ${actor}`);
  }
  for (const actor of [11,12,13,16,10]) {
    await assert.rejects(asUser(id(actor),'update operation_products set price=0 returning id'), {code:'42501'});
    await assert.rejects(asUser(id(actor),'delete from operation_passes returning id'), {code:'42501'});
  }
  assert.equal((await asUser(id(13),'select member_id from operation_members')).rows.length, 1);
  assert.equal((await asUser(id(15),'select id from operation_products')).rows.length, 0);
  await db.exec('begin');
  try {
    await assert.rejects(db.query(`insert into operation_passes(id,center_id,member_id,product_id,start_on,end_on,status)
      values($1,$2,$3,$4,current_date,current_date+30,'ACTIVE')`, [id(505), id(1), id(15), id(501)]), {code:'23503'});
  } finally { await db.exec('rollback'); }
  for (const [table, key] of [['notes',504],['pass_history',503],['passes',502],['products',501]]) {
    await db.query(`delete from operation_${table} where id=$1`,[id(key)]);
  }
}
