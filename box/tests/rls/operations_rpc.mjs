import assert from 'node:assert/strict';

export async function verifyOperationsRpc(db, asUser, id) {
  let sequence = 0;
  const call = async (actor, operation, input, key = `rpc-${++sequence}`, persist = true) =>
    (await asUser(id(actor), 'select operations_mutate($1,$2::jsonb,$3) as result', [operation, JSON.stringify(input), key], persist)).rows[0].result;
  const snapshot = async actor => (await asUser(id(actor),'select operations_snapshot() as result')).rows[0].result;
  const today = (await snapshot(11)).referenceDate;
  const center = (await snapshot(11)).center;
  const centerInput = {id:center.id,version:0,phone:'010-0000-0000',address:'Synthetic center',weekday_hours:'09:00–22:00',weekend_hours:'10:00–18:00'};
  const centerResult = await call(11,'center.save',centerInput,'center-details');
  assert.equal(centerResult.version,1);
  assert.deepEqual(await call(11,'center.save',centerInput,'center-details'),centerResult);
  await assert.rejects(call(11,'center.save',centerInput),{code:'23505'});
  await assert.rejects(call(12,'center.save',{...centerInput,version:1}),{code:'42501'});
  await assert.rejects(call(16,'center.save',{...centerInput,version:1}),{code:'42501'});
  assert.equal((await snapshot(13)).center.address,'Synthetic center');
  assert.notEqual((await snapshot(15)).center.address,'Synthetic center');
  const productInput = {name:'RPC product',kind:'COUNT',days:30,count:10,price:10000};
  const product = await call(11,'product.save',productInput,'rpc-product');
  assert.deepEqual(await call(11,'product.save',productInput,'rpc-product'),product);
  await assert.rejects(call(11,'product.save',{...productInput,price:20000},'rpc-product'),{code:'23505'});
  await assert.rejects(call(12,'product.save',productInput),{code:'42501'});
  await assert.rejects(call(13,'product.save',productInput),{code:'42501'});
  await assert.rejects(call(10,'product.save',productInput),{code:'42501'});
  const updatedProduct = await call(11,'product.save',{...product,price:11000});
  assert.equal(updatedProduct.version,2);
  await assert.rejects(call(11,'product.save',{...product,price:12000}),{code:'23505'});
  const input = {member_id:id(13),product_id:product.id,start_on:today,reason:'Synthetic assignment'};
  await assert.rejects(call(16,'pass.assign',input),{code:'P0002'});
  let pass = await call(12,'pass.assign',input);
  assert.equal(pass.remaining,10);
  for (const action of ['PAUSE','RESUME','EXTEND']) {
    pass = await call(12,'pass.change',{id:pass.id,version:pass.version,action,reason:'Synthetic change',end_on:'2099-12-31'});
  }
  assert.equal(pass.end_on,'2099-12-31');
  const memberSnapshot = await snapshot(13);
  assert.equal(memberSnapshot.passes.length,1);
  assert.equal(memberSnapshot.passes[0].history.length,4);
  assert.equal((await snapshot(15)).passes.length,0);
  const visit = await call(12,'attendance.mark',{member_id:id(13),visited_on:today,reason:'Synthetic visit'});
  await assert.rejects(call(11,'attendance.mark',{member_id:id(13),visited_on:today,reason:'Duplicate'}),{code:'23505'});
  await call(12,'attendance.cancel',{id:visit.id,version:visit.version,reason:'Synthetic cancellation'});
  const payment = await call(11,'payment.register',{member_id:id(13),product_id:product.id,amount:100,status:'PAID',method:'CASH',paid_on:today});
  await call(11,'payment.adjust',{id:payment.id,version:1,action:'REFUND',amount:40,on:today,reason:'Partial refund'});
  await assert.rejects(call(11,'payment.adjust',{id:payment.id,version:2,action:'REFUND',amount:61,on:today,reason:'Over refund'}),{code:'22023'});
  await call(11,'payment.adjust',{id:payment.id,version:2,action:'REFUND',amount:60,on:today,reason:'Remaining refund'});
  await call(12,'note.add',{member_id:id(13),content:'Synthetic confidential note'});
  const current = await snapshot(13);
  assert.equal(current.payments[0].status,'REFUNDED');
  assert.equal(current.payments[0].adjustments.length,2);
  assert.equal(current.notes.length,0);
  const member = current.members.find(row=>row.id===id(13));
  await call(11,'member.update',{id:id(13),version:member.version,name:'RPC member edit'});
  assert.equal((await snapshot(13)).members.find(row=>row.id===id(13)).name,'RPC member edit');
  await asUser(id(11),'select update_member_profile($1,$2::jsonb)',[id(40),JSON.stringify({phone:'Legacy API update'})],true);
  await assert.rejects(call(11,'member.update',{id:id(13),version:member.version+1,name:'Stale editor'}),{code:'23505'});
  await call(11,'member.delete',{id:id(13),version:member.version+2,reason:'Synthetic deletion'},'rpc-delete',false);
  assert.equal((await db.query('select status from accounts where id=$1',[id(13)])).rows[0].status,'ACTIVE');
  const previousAccount = (await db.query('select token_version from accounts where id=$1',[id(13)])).rows[0];
  await call(11,'member.delete',{id:id(13),version:member.version+2,reason:'Synthetic preserved deletion'},'rpc-delete-persist');
  assert.equal((await db.query('select status from accounts where id=$1',[id(13)])).rows[0].status,'SUSPENDED');
  await assert.rejects(asUser(id(11),'select update_member_profile($1,$2::jsonb)',[id(40),JSON.stringify({phone:'Blocked'})],true),{code:'42501'});
  await assert.rejects(db.query("update accounts set status='ACTIVE' where id=$1",[id(13)]),{code:'42501'});
  assert.equal((await db.query('select count(*)::int as total from operation_payments where member_id=$1',[id(13)])).rows[0].total,1);
  await db.query('update operation_members set deleted_on=null where member_id=$1',[id(13)]);
  await db.query("update accounts set status='ACTIVE',token_version=$2 where id=$1",[id(13),previousAccount.token_version]);
  for (const table of ['audit','requests','notes','adjustments','payments','attendance','pass_history','passes','products']) await db.exec(`delete from operation_${table}`);
}
