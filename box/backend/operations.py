from __future__ import annotations

import json
import secrets
from datetime import date, timedelta
from http import HTTPStatus

try:
    from domain import hash_password, verify_password, serialize
    from errors import ApiError
    from operations_summary import attendance_roster, revenue_months
    from operations_schema import center_now
except ModuleNotFoundError:
    from backend.domain import hash_password, verify_password, serialize
    from backend.errors import ApiError
    from backend.operations_summary import attendance_roster, revenue_months
    from backend.operations_schema import center_now


def text(value, field, limit=500):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise ValueError(f'{field}: required text, maximum {limit} characters')
    return value.strip()


def integer(value, field, minimum=0, maximum=9007199254740991):
    if isinstance(value, str) and value.isascii() and value.isdigit():
        value = int(value)
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'{field}: invalid integer')
    return value


def day(value):
    if not isinstance(value, str) or len(value) != 10 or date.fromisoformat(value).isoformat() != value:
        raise ValueError('invalid date')
    return value


def choice(value, options):
    if value not in options:
        raise ValueError('invalid choice')
    return value


def conflict(message):
    raise ApiError(message, HTTPStatus.CONFLICT)


class Operations:
    tables = {'products', 'passes', 'attendance', 'payments', 'notes', 'members'}
    owner_operations = {'product.save', 'payment.register', 'payment.adjust', 'member.create', 'member.delete', 'center.save'}

    def __init__(self, store):
        self.store = store
        self.connection = store.conn

    def actor(self, supplied):
        current = self.store.get_user(supplied.id)
        if not current or current.status != 'ACTIVE' or current.token_version != supplied.token_version:
            raise PermissionError('account is inactive or authorization changed')
        if current.role not in {'OWNER', 'CENTER_OWNER', 'COACH', 'MEMBER'}:
            raise PermissionError('operational data is outside your role')
        return current

    def now(self, center_id):
        return center_now(self.connection, center_id)

    def row(self, table, identity, center_id):
        if table not in self.tables:
            raise ValueError('invalid collection')
        key = 'member_id' if table == 'members' else 'id'
        result = self.connection.execute(f'select * from operation_{table} where {key}=? and center_id=?', (identity, center_id)).fetchone()
        if not result:
            raise ApiError('record not found in your center', HTTPStatus.NOT_FOUND)
        return dict(result)

    def member(self, identity, center_id, on=None):
        row = self.row('members', identity, center_id)
        if on:
            if not row['joined_on']:
                conflict('registration date is unknown; establish it before recording attendance')
            if row['joined_on'] > on or (row['deleted_on'] and row['deleted_on'] <= on):
                conflict('member was not registered on this date')
        elif row['deleted_on']:
            conflict('member is deleted')
        return row

    def insert(self, table, values):
        columns = ','.join(values)
        placeholders = ','.join('?' for _ in values)
        self.connection.execute(f'insert into operation_{table} ({columns}) values ({placeholders})', tuple(values.values()))
        return values

    def update(self, table, before, fields, version):
        if integer(version, 'version', 1) != before['version']:
            conflict('record changed; refresh before retrying')
        key = 'member_id' if table == 'members' else 'id'
        updated = {**fields, 'version': before['version'] + 1}
        assignments = ','.join(f'{column}=?' for column in updated)
        self.connection.execute(f'update operation_{table} set {assignments} where {key}=? and center_id=?', (*updated.values(), before[key], before['center_id']))
        return {**before, **updated}

    def snapshot(self, supplied, selected_on=None):
        with self.store.transaction():
            actor = self.actor(supplied)
            today = self.now(actor.gym_id)[:10]
            selected = day(selected_on or today)
            result = {'referenceDate': today, 'selectedDate': selected}
            result['center'] = self.center_details(actor.gym_id)
            profiles = self.store.profiles
            members = []
            for profile in profiles.values():
                if profile.gym_id != actor.gym_id or (actor.role == 'MEMBER' and profile.user_id != actor.id):
                    continue
                metadata = self.connection.execute('select * from operation_members where member_id=?', (profile.user_id,)).fetchone()
                if not metadata:
                    continue
                account = self.store.get_user(profile.user_id)
                members.append({**serialize(profile), **dict(metadata), 'id': profile.user_id, 'profile_id': profile.id, 'account_status': account.status})
            result['members'] = members
            for table in ('products', 'passes', 'attendance', 'payments', 'notes'):
                query = f'select * from operation_{table} where center_id=?'
                params = [actor.gym_id]
                if actor.role == 'MEMBER' and table != 'products':
                    query += ' and member_id=?'
                    params.append(actor.id)
                result[table] = [] if actor.role == 'MEMBER' and table == 'notes' else [dict(row) for row in self.connection.execute(query, params)]
            for row in result['passes']:
                row['history'] = [dict(item) for item in self.connection.execute('select history.*,users.name as author from operation_pass_history history join users on users.id=history.author_id where pass_id=? and center_id=? order by at,id', (row['id'], actor.gym_id))]
            for row in result['payments']:
                row['adjustments'] = [dict(item) for item in self.connection.execute('select adjustment.*,on_date as "on",users.name as author from operation_adjustments adjustment join users on users.id=adjustment.author_id where payment_id=? and center_id=? order by at,id', (row['id'], actor.gym_id))]
            for row in result['notes']:
                row['author_name'] = self.store.get_user(row['author_id']).name
            result['roster'] = attendance_roster(members, result['attendance'], selected, today)
            result['revenue'] = revenue_months(result['payments'], today)
            return result

    def mutate(self, supplied, operation, values, request_id):
        request_id = text(request_id, 'request_id', 128)
        if not isinstance(values, dict):
            raise ValueError('input must be an object')
        handlers = {
            'product.save': self.save_product, 'pass.assign': self.assign_pass,
            'pass.change': self.change_pass, 'attendance.mark': self.mark_attendance,
            'attendance.cancel': self.cancel_attendance, 'payment.register': self.register_payment,
            'payment.adjust': self.adjust_payment, 'note.add': self.add_note,
            'member.create': self.create_member, 'member.delete': self.delete_member,
            'member.update': self.update_member, 'center.save': self.save_center,
        }
        if operation not in handlers:
            raise ValueError('unknown operation')
        signature = json.dumps([operation, values], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        with self.store.transaction():
            actor = self.actor(supplied)
            if actor.role == 'MEMBER' or (operation in self.owner_operations and actor.role not in {'OWNER', 'CENTER_OWNER'}):
                raise PermissionError('operation is outside your role')
            prior = self.connection.execute('select * from operation_requests where actor_id=? and request_id=?', (actor.id, request_id)).fetchone()
            if prior:
                if prior['center_id'] != actor.gym_id or not verify_password(signature, prior['fingerprint']):
                    conflict('request_id already used with different input')
                return json.loads(prior['result'])
            now = self.now(actor.gym_id)
            before, result = handlers[operation](actor, values, now)
            self.insert('audit', {'id': secrets.token_hex(16), 'center_id': actor.gym_id, 'actor_id': actor.id,
                'operation': operation, 'target_id': result.get('id') or result.get('member_id'),
                'before_state': json.dumps(before), 'after_state': json.dumps(result), 'created_at': now})
            self.insert('requests', {'actor_id': actor.id, 'request_id': request_id, 'center_id': actor.gym_id,
                'fingerprint': hash_password(signature), 'result': json.dumps(result), 'created_at': now})
            return result

    def center_details(self, center_id):
        center = self.connection.execute('select name,code from gyms where id=?', (center_id,)).fetchone()
        details = self.connection.execute('select * from operation_center_details where center_id=?', (center_id,)).fetchone()
        return {'id': center_id, 'center_id': center_id, 'name': center['name'], 'code': center['code'],
            'phone': '', 'address': '', 'weekday_hours': '', 'weekend_hours': '', 'version': 0,
            **(dict(details) if details else {})}

    def save_center(self, actor, values, now):
        if values.get('id', actor.gym_id) != actor.gym_id or values.get('center_id', actor.gym_id) != actor.gym_id:
            raise PermissionError('center is outside your scope')
        before = self.center_details(actor.gym_id)
        if integer(values.get('version'), 'version') != before['version']:
            conflict('center changed; refresh before retrying')
        fields = {}
        for key, limit in [('phone', 40), ('address', 300), ('weekday_hours', 200), ('weekend_hours', 200)]:
            value = values.get(key, before[key])
            if not isinstance(value, str) or len(value) > limit:
                raise ValueError('invalid center field: ' + key)
            fields[key] = value.strip()
        if before['version']:
            self.update('center_details', before, fields, before['version'])
        else:
            self.insert('center_details', {'id': actor.gym_id, 'center_id': actor.gym_id, **fields, 'version': 1})
        return before, self.center_details(actor.gym_id)

    def save_product(self, actor, values, now):
        before = self.row('products', values['id'], actor.gym_id) if values.get('id') else {}
        fields = {'name': text(values.get('name'), 'name', 100), 'kind': choice(values.get('kind'), {'PERIOD', 'COUNT', 'TRIAL'}),
            'days': integer(values.get('days'), 'days', 1, 36500), 'count': integer(values.get('count'), 'count', 0, 1000000),
            'price': integer(values.get('price'), 'price')}
        if fields['kind'] != 'PERIOD' and fields['count'] == 0:
            raise ValueError('count is required for count and trial passes')
        result = self.update('products', before, fields, values.get('version')) if before else self.insert('products', {'id': secrets.token_hex(16), 'center_id': actor.gym_id, **fields, 'version': 1})
        return before, result

    def assign_pass(self, actor, values, now):
        self.member(values.get('member_id'), actor.gym_id)
        product = self.row('products', values.get('product_id'), actor.gym_id)
        start = day(values.get('start_on'))
        end = day(values.get('end_on') or (date.fromisoformat(start) + timedelta(days=product['days'] - 1)).isoformat())
        if end < start:
            raise ValueError('end date precedes start date')
        result = self.insert('passes', {'id': secrets.token_hex(16), 'center_id': actor.gym_id,
            'member_id': values['member_id'], 'product_id': product['id'], 'start_on': start, 'end_on': end,
            'remaining': None if product['kind'] == 'PERIOD' else product['count'], 'status': 'ACTIVE', 'version': 1})
        self.pass_history(actor, result, 'ASSIGN', values.get('reason'), now)
        return {}, result

    def pass_history(self, actor, result, action, reason, now, previous=None):
        self.insert('pass_history', {'id': secrets.token_hex(16), 'center_id': actor.gym_id, 'pass_id': result['id'],
            'action': action, 'reason': text(reason, 'reason'), 'author_id': actor.id, 'at': now,
            'previous_end_on': previous, 'end_on': result['end_on']})

    def change_pass(self, actor, values, now):
        before = self.row('passes', values.get('id'), actor.gym_id)
        self.member(before['member_id'], actor.gym_id)
        action = choice(values.get('action'), {'PAUSE', 'RESUME', 'EXTEND', 'CANCEL'})
        if before['status'] == 'CANCELLED' or (action == 'PAUSE' and before['status'] != 'ACTIVE') or (action == 'RESUME' and before['status'] != 'PAUSED'):
            conflict('pass status does not permit this action')
        if action == 'EXTEND':
            end = day(values.get('end_on'))
            if end <= before['end_on']:
                raise ValueError('extension must move the end date forward')
            fields = {'end_on': end}
        else:
            fields = {'status': {'PAUSE': 'PAUSED', 'RESUME': 'ACTIVE', 'CANCEL': 'CANCELLED'}[action]}
        result = self.update('passes', before, fields, values.get('version'))
        self.pass_history(actor, result, action, values.get('reason'), now, before['end_on'])
        return before, result

    def mark_attendance(self, actor, values, now):
        visited = day(values.get('visited_on'))
        if visited > now[:10]:
            raise ValueError('future attendance cannot be recorded')
        self.member(values.get('member_id'), actor.gym_id, visited)
        return {}, self.insert('attendance', {'id': secrets.token_hex(16), 'center_id': actor.gym_id,
            'member_id': values['member_id'], 'visited_on': visited, 'status': 'PRESENT',
            'reason': text(values.get('reason'), 'reason'), 'created_at': now, 'cancelled_at': None, 'version': 1})

    def cancel_attendance(self, actor, values, now):
        before = self.row('attendance', values.get('id'), actor.gym_id)
        if before['status'] != 'PRESENT':
            conflict('attendance is already cancelled')
        return before, self.update('attendance', before, {'status': 'CANCELLED', 'reason': text(values.get('reason'), 'reason'), 'cancelled_at': now}, values.get('version'))

    def register_payment(self, actor, values, now):
        self.member(values.get('member_id'), actor.gym_id)
        product = self.row('products', values.get('product_id'), actor.gym_id)
        status = choice(values.get('status'), {'PAID', 'UNPAID'})
        paid_on = day(values.get('paid_on')) if status == 'PAID' else None
        if paid_on and paid_on > now[:10]:
            raise ValueError('future payment cannot be recorded as received')
        return {}, self.insert('payments', {'id': secrets.token_hex(16), 'center_id': actor.gym_id,
            'member_id': values['member_id'], 'product_id': product['id'], 'amount': integer(values.get('amount'), 'amount', 1),
            'method': choice(values.get('method'), {'CARD', 'CASH', 'TRANSFER', 'KAKAOPAY', 'EASY_PAY'}), 'paid_on': paid_on, 'status': status, 'version': 1})

    def adjust_payment(self, actor, values, now):
        before = self.row('payments', values.get('id'), actor.gym_id)
        action = choice(values.get('action'), {'CANCEL', 'REFUND'})
        on = day(values.get('on'))
        if on > now[:10] or (before['paid_on'] and on < before['paid_on']):
            raise ValueError('adjustment date must follow payment and cannot be in the future')
        if before['status'] in {'CANCELLED', 'REFUNDED'}:
            conflict('payment is already closed')
        refunded = self.connection.execute('select coalesce(sum(amount),0) from operation_adjustments where payment_id=?', (before['id'],)).fetchone()[0]
        amount = integer(values.get('amount'), 'amount', 1) if action == 'REFUND' else 0
        if action == 'REFUND' and (not before['paid_on'] or refunded + amount > before['amount']):
            raise ValueError('refund exceeds received balance')
        if action == 'CANCEL' and refunded:
            conflict('record remaining refund instead of cancelling a partially refunded payment')
        status = 'CANCELLED' if action == 'CANCEL' else ('REFUNDED' if refunded + amount == before['amount'] else 'PARTIAL_REFUND')
        result = self.update('payments', before, {'status': status}, values.get('version'))
        self.insert('adjustments', {'id': secrets.token_hex(16), 'center_id': actor.gym_id, 'payment_id': before['id'],
            'action': action, 'amount': amount, 'reason': text(values.get('reason'), 'reason'),
            'on_date': on, 'author_id': actor.id, 'at': now})
        return before, result

    def add_note(self, actor, values, now):
        self.member(values.get('member_id'), actor.gym_id)
        return {}, self.insert('notes', {'id': secrets.token_hex(16), 'center_id': actor.gym_id, 'member_id': values['member_id'],
            'content': text(values.get('content'), 'content', 2000), 'author_id': actor.id, 'created_at': now})

    def create_member(self, actor, values, now):
        if values.get('password') != values.get('password_confirm'):
            raise ValueError('password confirmation does not match')
        account = self.store.create_user(values.get('username'), values.get('password'), 'MEMBER',
            text(values.get('name'), 'name', 100), actor.gym_id, values.get('email', ''))
        profile = self.store.create_profile(account, values.get('phone', ''), values.get('birthdate', ''), values.get('gender', ''))
        allowed = {'phone', 'birthdate', 'gender', 'height_cm', 'weight_kg', 'stance', 'injury_note', 'training_level'}
        profile = self.store.patch_profile(actor, profile.id, {key: value for key, value in values.items() if key in allowed}, bump_operation_version=False)
        joined = day(values.get('joined_on') or now[:10])
        if joined > now[:10]:
            raise ValueError('registration date cannot be in the future')
        self.connection.execute('update operation_members set joined_on=? where member_id=? and center_id=?', (joined, account.id, actor.gym_id))
        assigned = None
        if values.get('product_id'):
            _, assigned = self.assign_pass(actor, {'member_id': account.id, 'product_id': values['product_id'],
                'start_on': values.get('start_on') or joined, 'end_on': values.get('end_on'), 'reason': '회원 등록 시 이용권 부여'}, now)
        return {}, {**serialize(profile), 'id': account.id, 'profile_id': profile.id, 'joined_on': joined, 'version': 1, 'pass': assigned}

    def delete_member(self, actor, values, now):
        before = self.member(values.get('id'), actor.gym_id)
        text(values.get('reason'), 'reason')
        result = self.update('members', before, {'deleted_on': now[:10]}, values.get('version'))
        self.connection.execute("update users set status='SUSPENDED',token_version=token_version+1 where id=? and gym_id=?", (before['member_id'], actor.gym_id))
        return before, {**result, 'reason': values['reason']}

    def update_member(self, actor, values, now):
        before = self.member(values.get('id'), actor.gym_id)
        profile = self.store.profile_for_user(before['member_id'])
        if profile is None:
            raise ApiError('member profile not found', HTTPStatus.NOT_FOUND)
        fields = {}
        if values.get('joined_on') and values['joined_on'] != before['joined_on']:
            joined = day(values['joined_on'])
            if joined > now[:10]:
                raise ValueError('registration date cannot be in the future')
            text(values.get('reason'), 'registration correction reason')
            earlier = self.connection.execute('select 1 from operation_attendance where member_id=? and visited_on<? limit 1', (before['member_id'], joined)).fetchone()
            if earlier:
                conflict('registration date would exclude recorded attendance')
            fields['joined_on'] = joined
        allowed = {'name', 'phone', 'birthdate', 'gender', 'height_cm', 'weight_kg', 'stance', 'injury_note', 'training_level'}
        if values.get('pass_id'):
            selected_pass = self.row('passes', values['pass_id'], actor.gym_id)
            if selected_pass['member_id'] != before['member_id']:
                raise PermissionError('pass does not belong to this member')
            if selected_pass['status'] == 'CANCELLED':
                conflict('cancelled pass cannot be changed')
            end_on = day(values.get('end_on'))
            if end_on < selected_pass['start_on']:
                raise ValueError('end date precedes start date')
            if values.get('pass_version') != selected_pass['version']:
                conflict('stale pass version')
            if end_on != selected_pass['end_on']:
                changed = self.update('passes', selected_pass, {'end_on': end_on}, values.get('pass_version'))
                self.pass_history(actor, changed, 'SET_END', values.get('reason'), now, selected_pass['end_on'])
        elif values.get('end_on'):
            raise ValueError('select a pass before editing its end date')
        metadata = self.update('members', before, fields, values.get('version'))
        updated = self.store.patch_profile(actor, profile.id, {key: value for key, value in values.items() if key in allowed}, bump_operation_version=False)
        return {**serialize(profile), **before}, {**serialize(updated), **metadata, 'id': before['member_id'], 'profile_id': profile.id}
