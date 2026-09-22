import argparse
import json
import secrets
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', type=Path, required=True)
    args = parser.parse_args()
    settings = dict(line.split('=', 1) for line in args.settings.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#') and '=' in line)
    base = settings['BOXING_COACH_SUPABASE_URL'].strip().rstrip('/')
    reference = urlparse(base).hostname.split('.')[0]
    public_key = settings['BOXING_COACH_SUPABASE_PUBLISHABLE_KEY'].strip()
    management_token = settings['SUPABASE_ACCESS_TOKEN'].strip()
    domain = settings['BOXING_COACH_AUTH_EMAIL_DOMAIN'].strip()

    def request(url, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        try:
            with urlopen(Request(url, data=data, headers={'Content-Type': 'application/json', **(headers or {})}), timeout=60) as response:
                return json.load(response)
        except HTTPError as error:
            detail = json.loads(error.read())
            failure = RuntimeError(str(error.code) + ': ' + str(detail.get('error_description') or detail.get('message') or detail.get('error') or detail.get('msg')))
            failure.database_code = detail.get('code')
            raise failure from None

    def manage(path, body=None):
        return request('https://api.supabase.com/v1/projects/' + reference + path, body, {'Authorization': 'Bearer ' + management_token})

    def query(sql):
        return manage('/database/query', {'query': sql})

    def api(path, body=None, token=None):
        return request(base + path, body, {'apikey': public_key, **({'Authorization': 'Bearer ' + token} if token else {})})

    project = manage('')
    if project['name'] != 'boxingcoach-staging':
        raise ValueError('Only boxingcoach-staging is allowed')
    state_path = Path(__file__).resolve().parents[1] / 'artifacts/staging-smoke-accounts.json'
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state['project'] != reference:
            raise ValueError('Saved test state belongs to another project')
    else:
        suffix = secrets.token_hex(3)
        state = {'project': reference, 'suffix': suffix, 'accounts': {role: {'username': 'stg_' + role + '_' + suffix, 'password': 'Test!' + secrets.token_hex(16)} for role in ('platform', 'owner', 'coach', 'member')}}
        state_path.write_text(json.dumps(state), encoding='utf-8')

    def save():
        state_path.write_text(json.dumps(state), encoding='utf-8')

    def login(role):
        account = state['accounts'][role]
        return api('/auth/v1/token?grant_type=password', {'email': account['username'] + '@' + domain, 'password': account['password']})['access_token']

    platform = state['accounts']['platform']
    username = platform['username']
    if not state.get('platform_ready'):
        bootstrap_code = 'stg-bootstrap-' + state['suffix']
        query("insert into public.centers(name,code) values('Synthetic bootstrap','" + bootstrap_code + "') on conflict(code) do nothing")
        exists = query("select id from public.accounts where username='" + username + "'")
        if not exists:
            api('/auth/v1/signup', {'email': username + '@' + domain, 'password': platform['password'], 'data': {'username': username, 'name': 'Synthetic platform', 'role': 'MEMBER', 'center_code': bootstrap_code}})
        query("begin; delete from public.operation_members where member_id=(select id from public.accounts where username='" + username + "'); delete from public.member_profiles where user_id=(select id from public.accounts where username='" + username + "'); update public.accounts set role='PLATFORM_ADMIN',center_id=null,token_version=token_version+1 where username='" + username + "'; commit;")
        state['platform_ready'] = True
        save()
    platform_token = login('platform')
    print('Staging platform login verified', flush=True)
    if not state.get('center_id'):
        center = api('/rest/v1/rpc/platform_create_center', {'p_name': 'Synthetic staging center', 'p_code': 'stg-center-' + state['suffix']}, platform_token)
        state['center_id'] = center[0]['id']
        save()
    for role in ('owner', 'coach'):
        account = state['accounts'][role]
        if not account.get('created'):
            existing = query("select id from public.accounts where username='" + account['username'] + "'")
            if not existing:
                api('/functions/v1/admin-create-user', {**account, 'name': 'Synthetic ' + role, 'role': 'CENTER_OWNER' if role == 'owner' else 'COACH', 'center_id': state['center_id']}, platform_token)
            account['created'] = True
            save()
        login(role)
        print('Staging ' + role + ' login verified', flush=True)

    owner_token = login('owner')
    coach_token = login('coach')
    def operation(name, values, key, token=owner_token):
        return api('/rest/v1/rpc/operations_mutate', {'p_operation': name, 'p_input': values, 'p_request_id': 'smoke-' + state['suffix'] + '-' + key}, token)

    def denied(action):
        try:
            action()
        except RuntimeError as error:
            if str(error).startswith(('400:', '403:', '404:', '409:')) or getattr(error, 'database_code', None) == 'P0002':
                return
            raise
        raise AssertionError('Forbidden action succeeded')

    snapshot = api('/rest/v1/rpc/operations_snapshot', {}, owner_token)
    state.setdefault('test_day', snapshot['referenceDate'])
    save()
    today = state['test_day']
    product = operation('product.save', {'name': 'Synthetic staging pass', 'kind': 'COUNT', 'days': 30, 'count': 10, 'price': 10000}, 'product')
    denied(lambda: operation('product.save', {'name': 'Forbidden', 'kind': 'PERIOD', 'days': 30, 'count': 0, 'price': 100}, 'coach-product', coach_token))
    member = state['accounts']['member']
    registration = {'input': {'username': member['username'], 'password': member['password'], 'password_confirm': member['password'], 'name': 'Synthetic member', 'product_id': product['id'], 'joined_on': today}, 'request_id': 'smoke-' + state['suffix'] + '-member'}
    registered = api('/functions/v1/register-member', registration, owner_token)
    assert registered == api('/functions/v1/register-member', registration, owner_token)
    member_id = registered['result']['id']
    member_token = login('member')
    before = api('/rest/v1/rpc/operations_snapshot', {}, member_token)
    assigned = before['passes'][0]
    assert assigned['remaining'] == 10 and before['members'][0]['id'] == member_id
    operation('member.update', {'id': member_id, 'version': 1, 'name': 'Synthetic edited member', 'height_cm': 181, 'weight_kg': 82, 'training_level': 3, 'stance': 'southpaw', 'injury_note': 'Synthetic profile memo', 'pass_id': assigned['id'], 'pass_version': 1, 'end_on': today, 'reason': 'Synthetic expiry correction'}, 'member-edit')
    updated = api('/rest/v1/rpc/operations_snapshot', {}, member_token)
    assert updated['members'][0]['height_cm'] == 181
    assert updated['passes'][0]['end_on'] == today
    assert any(row['action'] == 'SET_END' for row in updated['passes'][0]['history'])
    receipt = operation('payment.register', {'member_id': member_id, 'product_id': product['id'], 'amount': 10000, 'method': 'KAKAOPAY', 'status': 'PAID', 'paid_on': today}, 'payment')
    operation('payment.adjust', {'id': receipt['id'], 'version': 1, 'action': 'REFUND', 'amount': 4000, 'on': today, 'reason': 'Synthetic partial refund'}, 'refund')
    visit = operation('attendance.mark', {'member_id': member_id, 'visited_on': today, 'reason': 'Synthetic visit'}, 'visit', coach_token)
    denied(lambda: operation('attendance.mark', {'member_id': member_id, 'visited_on': today, 'reason': 'Duplicate'}, 'visit-duplicate', coach_token))
    denied(lambda: operation('center.save', {'id': state['center_id'], 'version': 0, 'phone': 'Forbidden'}, 'member-center', member_token))
    operation('center.save', {'id': state['center_id'], 'version': 0, 'phone': '010-0000-0000', 'address': 'Synthetic address', 'weekday_hours': '09:00-22:00', 'weekend_hours': '10:00-18:00'}, 'center')
    final = api('/rest/v1/rpc/operations_snapshot', {}, member_token)
    assert final['center']['address'] == 'Synthetic address'
    assert final['payments'][0]['method'] == 'KAKAOPAY'
    assert final['payments'][0]['status'] == 'PARTIAL_REFUND'
    assert final['attendance'][0]['id'] == visit['id']
    if not state.get('other_center_id'):
        other_center = api('/rest/v1/rpc/platform_create_center', {'p_name': 'Synthetic isolated center', 'p_code': 'stg-other-' + state['suffix']}, platform_token)
        state['other_center_id'] = other_center[0]['id']
        save()
    if 'other' not in state['accounts']:
        state['accounts']['other'] = {'username': 'stg_other_' + state['suffix'], 'password': 'Test!' + secrets.token_hex(16)}
        save()
    other = state['accounts']['other']
    if not other.get('created'):
        existing = query("select id from public.accounts where username='" + other['username'] + "'")
        if not existing:
            api('/functions/v1/admin-create-user', {**other, 'name': 'Synthetic isolated owner', 'role': 'CENTER_OWNER', 'center_id': state['other_center_id']}, platform_token)
        other['created'] = True
        save()
    other_token = login('other')
    isolated = api('/rest/v1/rpc/operations_snapshot', {}, other_token)
    assert isolated['center']['id'] == state['other_center_id']
    assert not any(row['id'] == member_id for row in isolated['members'])
    assert not any(row['id'] == assigned['id'] for row in isolated['passes'])
    denied(lambda: operation('member.update', {'id': member_id, 'version': 2, 'name': 'Forbidden'}, 'foreign-member', other_token))
    denied(lambda: operation('center.save', {'id': state['center_id'], 'version': 1, 'phone': 'Forbidden'}, 'foreign-center', other_token))
    denied(lambda: operation('payment.register', {'member_id': member_id, 'amount': 100, 'method': 'EASY_PAY', 'status': 'PAID', 'paid_on': today}, 'foreign-payment', other_token))
    state['operations_verified'] = True
    motion_session = api('/rest/v1/rpc/start_training_session', {'p_user_id': member_id, 'p_request_id': 'smoke-' + state['suffix'] + '-motion-tracking-v1'}, member_token)[0]
    report = {'version': 1, 'status': 'experimental', 'algorithm': 'rules-v1', 'stance': 'southpaw', 'duration_ms': 500,
              'events': [{'id': 'synthetic-jab', 'label': 'jab', 'hand': 'right', 'start_ms': 50, 'end_ms': 300, 'quality': 75, 'confidence': 0.9, 'points': 999, 'guard_ratio': 0.25}]}
    motion_body = {'p_session_id': motion_session['id'], 'p_report': report}
    report['tracking'] = {'gaps': [{'start_ms': 0, 'end_ms': 50, 'reason': 'no_result'}], 'total_ms': 50, 'truncated': False}
    finished = api('/rest/v1/rpc/finish_motion_round', motion_body, member_token)[0]
    assert finished['feedback_report']['total_points'] == 8
    assert finished['feedback_report']['events'][0]['guard_ratio'] == 0.25
    assert finished['feedback_report']['tracking'] == report['tracking']
    assert finished['overall_score'] == 75 and finished['ended_at']
    for token in (member_token, owner_token, coach_token):
        assert api('/rest/v1/rpc/finish_motion_round', motion_body, token)[0] == finished
    denied(lambda: api('/rest/v1/rpc/finish_motion_round', motion_body, other_token))
    denied(lambda: api('/rest/v1/rpc/finish_motion_round', motion_body, platform_token))
    denied(lambda: api('/rest/v1/rpc/finish_motion_round', {**motion_body, 'p_report': {**report, 'events': []}}, member_token))
    saved = api('/rest/v1/training_sessions?id=eq.' + motion_session['id'] + '&select=feedback_report', token=member_token)
    assert saved[0]['feedback_report'] == finished['feedback_report']
    assert api('/rest/v1/training_sessions?id=eq.' + motion_session['id'] + '&select=id', token=other_token) == []
    audit = query("select count(*) as count from public.operation_audit where operation='round.finish' and target_id='" + motion_session['id'] + "'")
    assert audit[0]['count'] == 1
    state['motion_verified'] = True
    save()
    print('Staging synthetic motion round: score recomputation, persistence, retry, audit and tenant isolation passed', flush=True)
    print('Staging Auth, Edge registration/retry, profile/expiry, payment/refund, attendance, roles and cross-center isolation passed', flush=True)


if __name__ == '__main__':
    main()
