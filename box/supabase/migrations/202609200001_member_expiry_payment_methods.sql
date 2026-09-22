begin;
alter table public.operation_pass_history drop constraint operation_pass_history_action_check;
alter table public.operation_pass_history add constraint operation_pass_history_action_check check(action in ('ASSIGN','PAUSE','RESUME','EXTEND','CANCEL','SET_END'));
alter table public.operation_payments drop constraint operation_payments_method_check;
alter table public.operation_payments add constraint operation_payments_method_check check(method in ('CARD','CASH','TRANSFER','KAKAOPAY','EASY_PAY'));

create or replace function public.operations_mutate(p_operation text,p_input jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path=public,auth,extensions as $$
declare
  actor public.accounts%rowtype;
  previous public.operation_requests%rowtype;
  product public.operation_products%rowtype;
  member public.operation_members%rowtype;
  pass public.operation_passes%rowtype;
  visit public.operation_attendance%rowtype;
  payment public.operation_payments%rowtype;
  identity uuid;
  start_day date;
  end_day date;
  event_day date;
  today date;
  zone text;
  action text;
  reason text;
  kind text;
  adjustment_amount bigint;
  refunded bigint;
  expected_version integer;
  before_state jsonb:='{}';
  result jsonb;
  signature text;
begin
  actor:=public.operations_actor();
  if actor.role='MEMBER' or (p_operation in ('product.save','payment.register','payment.adjust','member.delete') and actor.role<>'CENTER_OWNER') then
    raise exception 'operation outside role' using errcode='42501';
  end if;
  if p_operation is null or p_operation not in ('product.save','pass.assign','pass.change','attendance.mark','attendance.cancel','payment.register','payment.adjust','note.add','member.update','member.delete') then
    raise exception 'unsupported operation' using errcode='22023';
  end if;
  perform public.operations_text(to_jsonb(p_request_id),'request_id',128);
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'input object required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||':'||p_request_id,0));
  perform 1 from public.accounts where id=actor.id for share;
  actor:=public.operations_actor();
  signature:=jsonb_build_array(p_operation,p_input)::text;
  select * into previous from public.operation_requests where actor_id=actor.id and request_id=p_request_id;
  if found then
    if previous.center_id<>actor.center_id or previous.fingerprint<>encode(extensions.digest(signature,'sha256'),'hex') then
      raise exception 'request_id already used for different input' using errcode='23505';
    end if;
    return previous.result;
  end if;
  select timezone into zone from public.operation_centers where center_id=actor.center_id;
  today:=(now() at time zone coalesce(zone,'Asia/Seoul'))::date;
  identity:=coalesce(nullif(p_input->>'id','')::uuid,extensions.gen_random_uuid());
  if p_input ? 'id' and nullif(p_input->>'id','') is not null then
    expected_version:=public.operations_integer(p_input->'version',1,2147483647)::integer;
  end if;
  if p_operation='product.save' then
    select * into product from public.operation_products where id=identity and center_id=actor.center_id for update;
    if nullif(p_input->>'id','') is not null and product.id is null then raise exception 'product not found' using errcode='P0002'; end if;
    if product.id is not null and product.version<>expected_version then raise exception 'stale product version' using errcode='23505'; end if;
    before_state:=coalesce(to_jsonb(product),'{}');
    kind:=p_input->>'kind';
    if kind is null or kind not in ('PERIOD','COUNT','TRIAL') then raise exception 'invalid product kind' using errcode='22023'; end if;
    insert into public.operation_products(id,center_id,name,kind,days,count,price,version)
      values(identity,actor.center_id,public.operations_text(p_input->'name','name',100),kind,
        public.operations_integer(p_input->'days',1,36500),public.operations_integer(p_input->'count',case when kind='PERIOD' then 0 else 1 end,1000000),
        public.operations_integer(p_input->'price'),coalesce(product.version,0)+1)
      on conflict(id) do update set name=excluded.name,kind=excluded.kind,days=excluded.days,count=excluded.count,price=excluded.price,version=excluded.version
      returning to_jsonb(operation_products.*) into result;
  elsif p_operation in ('pass.assign','attendance.mark','payment.register','note.add') then
    select * into member from public.operation_members where member_id=(p_input->>'member_id')::uuid and center_id=actor.center_id for update;
    if member.member_id is null then raise exception 'member not found' using errcode='P0002'; end if;
    if p_operation<>'attendance.mark' and member.deleted_on is not null then raise exception 'member is deleted' using errcode='23505'; end if;
    if p_operation in ('pass.assign','payment.register') then
      select * into product from public.operation_products where id=(p_input->>'product_id')::uuid and center_id=actor.center_id for share;
      if product.id is null then raise exception 'product not found' using errcode='P0002'; end if;
    end if;
    if p_operation='pass.assign' then
      start_day:=public.operations_day(p_input->>'start_on');
      end_day:=case when nullif(p_input->>'end_on','') is null then start_day+product.days-1 else public.operations_day(p_input->>'end_on') end;
      reason:=public.operations_text(p_input->'reason','reason');
      insert into public.operation_passes(id,center_id,member_id,product_id,start_on,end_on,remaining,status)
        values(identity,actor.center_id,member.member_id,product.id,start_day,end_day,case when product.kind='PERIOD' then null else product.count end,'ACTIVE') returning * into pass;
      insert into public.operation_pass_history(id,center_id,pass_id,action,reason,author_id,at,end_on,author_name)
        values(extensions.gen_random_uuid(),actor.center_id,identity,'ASSIGN',reason,actor.id,now(),end_day,actor.display_name);
      result:=to_jsonb(pass);
    elsif p_operation='attendance.mark' then
      event_day:=public.operations_day(p_input->>'visited_on');
      if event_day>today or member.joined_on is null or member.joined_on>event_day or member.deleted_on<=event_day then
        raise exception 'member was not registered on this date' using errcode='22023';
      end if;
      insert into public.operation_attendance(id,center_id,member_id,visited_on,status,reason,created_at)
        values(identity,actor.center_id,member.member_id,event_day,'PRESENT',public.operations_text(p_input->'reason','reason'),now()) returning to_jsonb(operation_attendance.*) into result;
    elsif p_operation='payment.register' then
      kind:=p_input->>'status';
      if kind is null or kind not in ('PAID','UNPAID') then raise exception 'invalid payment status' using errcode='22023'; end if;
      event_day:=case when kind='PAID' then public.operations_day(p_input->>'paid_on') else null end;
      if event_day>today then raise exception 'future payment' using errcode='22023'; end if;
      insert into public.operation_payments(id,center_id,member_id,product_id,amount,method,paid_on,status)
        values(identity,actor.center_id,member.member_id,product.id,public.operations_integer(p_input->'amount',1),p_input->>'method',event_day,kind) returning to_jsonb(operation_payments.*) into result;
    else
      insert into public.operation_notes(id,center_id,member_id,content,author_id,created_at,author_name)
        values(identity,actor.center_id,member.member_id,public.operations_text(p_input->'content','content',2000),actor.id,now(),actor.display_name) returning to_jsonb(operation_notes.*) into result;
    end if;
  elsif p_operation='pass.change' then
    select * into pass from public.operation_passes where id=identity and center_id=actor.center_id for update;
    if pass.id is null then raise exception 'pass not found' using errcode='P0002'; end if;
    if pass.version<>expected_version then raise exception 'stale pass version' using errcode='23505'; end if;
    select * into member from public.operation_members where member_id=pass.member_id for update;
    if member.deleted_on is not null then raise exception 'member is deleted' using errcode='23505'; end if;
    before_state:=to_jsonb(pass); action:=p_input->>'action'; reason:=public.operations_text(p_input->'reason','reason');
    if action is null or action not in ('PAUSE','RESUME','EXTEND','CANCEL') then raise exception 'invalid pass action' using errcode='22023'; end if;
    if pass.status='CANCELLED' or (action='PAUSE' and pass.status<>'ACTIVE') or (action='RESUME' and pass.status<>'PAUSED') then raise exception 'invalid pass state' using errcode='23505'; end if;
    end_day:=pass.end_on;
    if action='EXTEND' then
      end_day:=public.operations_day(p_input->>'end_on');
      if end_day<=pass.end_on then raise exception 'extension must move date forward' using errcode='22023'; end if;
    end if;
    update public.operation_passes set end_on=end_day,status=case action when 'PAUSE' then 'PAUSED' when 'RESUME' then 'ACTIVE' when 'CANCEL' then 'CANCELLED' else status end,version=version+1 where id=identity returning to_jsonb(operation_passes.*) into result;
    insert into public.operation_pass_history(id,center_id,pass_id,action,reason,author_id,at,previous_end_on,end_on,author_name)
      values(extensions.gen_random_uuid(),actor.center_id,identity,action,reason,actor.id,now(),pass.end_on,end_day,actor.display_name);
  elsif p_operation='attendance.cancel' then
    select * into visit from public.operation_attendance where id=identity and center_id=actor.center_id for update;
    if visit.id is null then raise exception 'attendance not found' using errcode='P0002'; end if;
    if visit.version<>expected_version or visit.status<>'PRESENT' then raise exception 'stale attendance state' using errcode='23505'; end if;
    before_state:=to_jsonb(visit);
    update public.operation_attendance set status='CANCELLED',reason=public.operations_text(p_input->'reason','reason'),cancelled_at=now(),version=version+1 where id=identity returning to_jsonb(operation_attendance.*) into result;
  elsif p_operation='payment.adjust' then
    select * into payment from public.operation_payments where id=identity and center_id=actor.center_id for update;
    if payment.id is null then raise exception 'payment not found' using errcode='P0002'; end if;
    if payment.version<>expected_version or payment.status in ('CANCELLED','REFUNDED') then raise exception 'stale payment state' using errcode='23505'; end if;
    action:=p_input->>'action'; event_day:=public.operations_day(p_input->>'on'); reason:=public.operations_text(p_input->'reason','reason');
    if action is null or action not in ('CANCEL','REFUND') or event_day>today or event_day<payment.paid_on then raise exception 'invalid payment adjustment' using errcode='22023'; end if;
    select coalesce(sum(adjustment.amount),0) into refunded from public.operation_adjustments adjustment where payment_id=identity;
    adjustment_amount:=case when action='REFUND' then public.operations_integer(p_input->'amount',1) else 0 end;
    if (action='REFUND' and (payment.paid_on is null or adjustment_amount+refunded>payment.amount)) or (action='CANCEL' and refunded>0) then raise exception 'invalid refund balance' using errcode='22023'; end if;
    before_state:=to_jsonb(payment);
    update public.operation_payments set status=case when action='CANCEL' then 'CANCELLED' when adjustment_amount+refunded=operation_payments.amount then 'REFUNDED' else 'PARTIAL_REFUND' end,version=version+1 where id=identity returning to_jsonb(operation_payments.*) into result;
    insert into public.operation_adjustments(id,center_id,payment_id,action,amount,reason,on_date,author_id,at,author_name)
      values(extensions.gen_random_uuid(),actor.center_id,identity,action,adjustment_amount,reason,event_day,actor.id,now(),actor.display_name);
  else
    select * into member from public.operation_members where member_id=identity and center_id=actor.center_id for update;
    if member.member_id is null then raise exception 'member not found' using errcode='P0002'; end if;
    if member.version<>expected_version or member.deleted_on is not null then raise exception 'stale member state' using errcode='23505'; end if;
    before_state:=to_jsonb(member);
    if p_operation='member.delete' then
      reason:=public.operations_text(p_input->'reason','reason');
      update public.operation_members set deleted_on=today,version=version+1 where member_id=identity returning to_jsonb(operation_members.*)||jsonb_build_object('reason',reason) into result;
      update public.accounts set status='SUSPENDED',token_version=token_version+1 where id=identity;
    else
      event_day:=coalesce(nullif(p_input->>'joined_on','')::date,member.joined_on);
      if event_day is distinct from member.joined_on then
        event_day:=public.operations_day(p_input->>'joined_on');
        reason:=public.operations_text(p_input->'reason','registration correction reason');
        if event_day>today or exists(select 1 from public.operation_attendance where member_id=identity and visited_on<event_day) then raise exception 'registration excludes existing attendance' using errcode='22023'; end if;
      end if;
      if nullif(p_input->>'pass_id','') is not null then
        select * into pass from public.operation_passes where id=(p_input->>'pass_id')::uuid and center_id=actor.center_id for update;
        if pass.id is null then raise exception 'pass not found' using errcode='P0002'; end if;
        if pass.member_id<>identity then raise exception 'pass does not belong to member' using errcode='42501'; end if;
        if pass.status='CANCELLED' or pass.version<>public.operations_integer(p_input->'pass_version',1) then raise exception 'stale or cancelled pass' using errcode='23505'; end if;
        end_day:=public.operations_day(p_input->>'end_on');
        if end_day<pass.start_on then raise exception 'end date precedes start date' using errcode='22023'; end if;
        if end_day<>pass.end_on then
          reason:=public.operations_text(p_input->'reason','expiry change reason');
          update public.operation_passes set end_on=end_day,version=version+1 where id=pass.id;
          insert into public.operation_pass_history(id,center_id,pass_id,action,reason,author_id,at,previous_end_on,end_on,author_name)
            values(extensions.gen_random_uuid(),actor.center_id,pass.id,'SET_END',reason,actor.id,now(),pass.end_on,end_day,actor.display_name);
        end if;
      elsif nullif(p_input->>'end_on','') is not null then
        raise exception 'select a pass before editing its end date' using errcode='22023';
      end if;
      perform public.update_member_profile(profile.id,(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_input) where key in ('name','phone','birthdate','gender','height_cm','weight_kg','stance','injury_note','training_level')))
        from public.member_profiles profile where profile.user_id=identity;
      update public.operation_members set joined_on=event_day,version=member.version+1 where member_id=identity returning to_jsonb(operation_members.*) into result;
    end if;
  end if;
  insert into public.operation_audit(id,center_id,actor_id,operation,target_id,before_state,after_state,created_at)
    values(extensions.gen_random_uuid(),actor.center_id,actor.id,p_operation,identity::text,before_state,result,now());
  insert into public.operation_requests(actor_id,request_id,center_id,fingerprint,result,created_at)
    values(actor.id,p_request_id,actor.center_id,encode(extensions.digest(signature,'sha256'),'hex'),result,now());
  return result;
end $$;
revoke all on function public.operations_mutate(text,jsonb,text) from public,anon;
grant execute on function public.operations_mutate(text,jsonb,text) to authenticated;


commit;
