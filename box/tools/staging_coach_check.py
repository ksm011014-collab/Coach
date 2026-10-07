import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description='Staging coach readiness; model calls require explicit paid-test options.')
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--smoke', action='store_true', help='Use existing synthetic staging accounts to check authenticated config, usage and anonymous rejection; no model calls')
    parser.add_argument('--paid-model', help='Approved enabled model for exactly two real replies, Korean and English; requires --smoke and a new --evidence path')
    parser.add_argument('--evidence', type=Path, help='New local JSONL evidence file for an explicitly approved paid test; never automatically resumes or retries')
    args = parser.parse_args()
    if args.paid_model and (not args.smoke or not args.evidence):
        parser.error('--paid-model requires --smoke and --evidence; obtain user approval before using it')
    if args.evidence and (not args.paid_model or args.evidence.exists()):
        parser.error('--evidence requires --paid-model and a new path')
    settings = dict(line.split('=', 1) for line in args.settings.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#') and '=' in line)
    hostname = urlparse(settings['BOXING_COACH_SUPABASE_URL'].strip()).hostname
    if not hostname or not hostname.endswith('.supabase.co'):
        raise ValueError('Invalid project hostname')
    reference = hostname.split('.')[0]
    token = settings.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not token:
        raise ValueError('Management token is missing')

    def read(suffix):
        request = Request('https://api.supabase.com/v1/projects/' + reference + suffix, headers={'Authorization': 'Bearer ' + token})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    project = read('')
    if project['name'] != 'boxingcoach-staging' or project['status'] != 'ACTIVE_HEALTHY':
        raise ValueError('Only healthy boxingcoach-staging is allowed')
    functions = read('/functions')
    secrets = read('/secrets')
    coach = next((function for function in functions if function.get('slug') == 'coach-chat'), None)
    print(json.dumps({'project': project['name'], 'coach_function': None if coach is None else {
        'status': coach.get('status'), 'verify_jwt': coach.get('verify_jwt'), 'version': coach.get('version')},
        'openai_key_configured': any(secret.get('name') == 'OPENAI_API_KEY' for secret in secrets)}))
    if not args.smoke:
        return
    if not coach or coach.get('status') != 'ACTIVE' or coach.get('verify_jwt') is not True:
        raise ValueError('Active JWT-protected coach function required')
    base = settings['BOXING_COACH_SUPABASE_URL'].strip().rstrip('/')
    public_key = settings['BOXING_COACH_SUPABASE_PUBLISHABLE_KEY'].strip()
    state_path = Path(__file__).resolve().parents[1] / 'artifacts/staging-smoke-accounts.json'
    state = json.loads(state_path.read_text(encoding='utf-8'))
    if state['project'] != reference:
        raise ValueError('Synthetic accounts belong to another project')

    def call(suffix, body, access_token=None):
        headers = {'Content-Type': 'application/json', 'apikey': public_key}
        if access_token:
            headers['Authorization'] = 'Bearer ' + access_token
        request = Request(base + suffix, data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, None

    status, _ = call('/functions/v1/coach-chat', {'action': 'config'})
    if status != 401:
        raise ValueError('Anonymous coach request was not rejected')
    print('Anonymous coach request rejected', flush=True)
    identities = {}
    configurations = {}
    for role, scope in [('platform', 'platform'), ('owner', 'center'), ('coach', 'center'), ('member', 'self'), ('other', 'center')]:
        account = state['accounts'][role]
        status, identity = call('/auth/v1/token?grant_type=password', {
            'email': account['username'] + '@' + settings['BOXING_COACH_AUTH_EMAIL_DOMAIN'].strip(), 'password': account['password']})
        if status != 200 or not identity.get('access_token'):
            raise ValueError('Synthetic ' + role + ' login failed: ' + str(status))
        access_token = identity['access_token']
        identities[role] = access_token
        status, config = call('/functions/v1/coach-chat', {'action': 'config'}, access_token)
        if status != 200 or not isinstance(config.get('models'), list):
            raise ValueError('Synthetic ' + role + ' config failed: ' + str(status))
        configurations[role] = config
        status, usage = call('/rest/v1/rpc/coach_usage', {}, access_token)
        if status != 200 or usage.get('scope') != scope or usage.get('timezone') != 'UTC':
            raise ValueError('Synthetic ' + role + ' usage scope failed: ' + str(status))
        if usage.get('requests') == 0 and any(usage.get(key) is not None for key in ['input_tokens', 'output_tokens', 'total_tokens']):
            raise ValueError('Unmeasured usage was presented as a measurement')
        print(json.dumps({'role': role, 'config_verified': True, 'available': config.get('available'), 'usage_scope': scope}), flush=True)

    status, saved_sessions = call('/rest/v1/training_sessions?select=id&ended_at=not.is.null&order=ended_at.desc&limit=1', None, identities['member'])
    if status != 200 or not saved_sessions:
        raise ValueError('No completed synthetic round for transcript verification')
    for role in ('member', 'owner', 'coach', 'platform', 'other'):
        status, transcript = call('/rest/v1/rpc/coach_transcript', {'p_session_id': saved_sessions[0]['id']}, identities[role])
        expected = 200 if role in ('member', 'owner', 'coach') else 403
        if status != expected:
            raise ValueError('Transcript permission mismatch: ' + role)
        print(json.dumps({'role': role, 'transcript_access_verified': True, 'allowed': expected == 200}), flush=True)

    if not args.paid_model:
        return
    config = configurations['member']
    if not config.get('available') or args.paid_model not in [model['model_id'] for model in config['models']]:
        raise ValueError('Requested paid model is unavailable; no provider call made')
    status, sessions = call('/rest/v1/training_sessions?select=id&ended_at=not.is.null&order=ended_at.desc&limit=1', None, identities['member'])
    if status != 200 or not sessions:
        raise ValueError('No completed round for the existing synthetic member; no provider call made')
    session_id = sessions[0]['id']
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    with args.evidence.open('x', encoding='utf-8') as evidence:
        def record(value):
            evidence.write(json.dumps(value, ensure_ascii=False) + '\n')
            evidence.flush()

        expected_tokens = {name: 0 for name in ('input_tokens', 'output_tokens', 'total_tokens')}
        status, before = call('/rest/v1/rpc/coach_usage', {}, identities['member'])
        if status != 200:
            raise ValueError('Initial usage read failed')
        for language, question in [('ko', '오늘 운동이 즐거웠어. 다음에는 조금 더 오래 해보고 싶어.'), ('en', 'I feel good after my workout. Can we practice a short English conversation?')]:
            body = {'action': 'reply', 'request_id': str(uuid4()), 'session_id': session_id,
                    'model': args.paid_model, 'language': language, 'question': question, 'history': []}
            record({'stage': 'before_send', 'request_id': body['request_id'], 'model': args.paid_model, 'language': language})
            status, result = call('/functions/v1/coach-chat', body, identities['member'])
            record({'stage': 'reply', 'status': status, 'result': result})
            if status != 200 or not result.get('text') or result.get('usage_recorded') is not True:
                raise ValueError('Reply or usage persistence failed; do not automatically retry; inspect evidence')
            if result.get('transcript_recorded') is not True:
                raise ValueError('Reply transcript was not persisted')
            transcript_status, transcript = call('/rest/v1/rpc/coach_transcript', {'p_session_id': session_id}, identities['member'])
            saved = next((turn for turn in transcript.get('turns', []) if turn['request_id'] == body['request_id']), None) if transcript_status == 200 else None
            if not saved or saved['question'] != question or saved['answer'] != result['text']:
                raise ValueError('Persisted conversation does not match actual input/output')
            record({'stage': 'transcript_readback', 'language': language, 'verified': True})
            for name in expected_tokens:
                value = result.get('usage', {}).get(name)
                if type(value) is not int or value < 0:
                    raise ValueError('Provider usage is unmeasured; inspect evidence')
                expected_tokens[name] += value
            duplicate_status, _ = call('/functions/v1/coach-chat', body, identities['member'])
            record({'stage': 'duplicate', 'status': duplicate_status})
            if duplicate_status != 409:
                raise ValueError('Duplicate request was not rejected')
        status, after = call('/rest/v1/rpc/coach_usage', {}, identities['member'])
        if status != 200 or after['requests'] != before['requests'] + 2:
            raise ValueError('Usage request count mismatch or concurrent account activity')
        if any(after[name] != (before[name] or 0) + expected_tokens[name] for name in expected_tokens):
            raise ValueError('Aggregated provider token counts do not match')
        for role in ('owner', 'coach', 'platform', 'other'):
            status, rows = call('/rest/v1/coach_requests?select=actor_id,center_id,status,input_tokens,output_tokens,total_tokens&center_id=eq.' + state['center_id'], None, identities[role])
            if status != 200 or (role == 'other' and rows) or (role != 'other' and not rows):
                raise ValueError('Populated usage access check failed for ' + role)
        record({'stage': 'verified', 'provider_usage': expected_tokens, 'usage_delta': 2, 'duplicate_rejected': True, 'populated_usage_isolation': True})
        print('Two paid replies, provider usage aggregation, duplicate rejection and populated usage isolation verified; inspect evidence for response language and factual grounding.', flush=True)


if __name__ == '__main__':
    main()
