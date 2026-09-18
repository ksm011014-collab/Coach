import json
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch

from backend import server
from backend.domain import sign_token
from fixtures import populated_store


class LocalAuthorizationHttpTests(unittest.TestCase):
    def setUp(self):
        self.store = populated_store()
        self.addCleanup(self.store.conn.close)
        self.users = {user.role: user for user in self.store.users.values()}
        center = self.users['MEMBER'].gym_id
        for role in ('COACH', 'CENTER_OWNER', 'PLATFORM_ADMIN'):
            self.users[role] = self.store.create_user(role.lower(), 'Synthetic!123', role, role, center)
        other = self.store.create_gym('Other', 'other')
        self.users['OTHER'] = self.store.create_user('other_member', 'Synthetic!123', 'MEMBER', 'Other', other.id)
        self.tokens = {role: sign_token(user) for role, user in self.users.items()}
        for name, value in [('STORE', self.store), ('CENTRAL_GATEWAY', None)]:
            patcher = patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        silence = patch.object(server.ApiHandler, 'log_request', lambda *args: None)
        silence.start()
        self.addCleanup(silence.stop)
        http = server.create_server('127.0.0.1', 0)
        self.url = f'http://127.0.0.1:{http.server_address[1]}/api'
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        def close():
            http.shutdown()
            http.server_close()
            thread.join()
        self.addCleanup(close)

    def api(self, method, path, role='MEMBER', body=None):
        request = Request(self.url + path, method=method,
                          headers={'Authorization': 'Bearer ' + self.tokens[role], 'Content-Type': 'application/json'},
                          data=json.dumps(body).encode() if body is not None else None)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_session_roles_retries_and_exact_routes(self):
        member = self.users['MEMBER']
        for role in ('MEMBER','OWNER','CENTER_OWNER','COACH'):
            body = {'user_id':member.id,'request_id':role}
            status, payload = self.api('POST','/sessions',role,body)
            self.assertEqual(status,201,role)
            identifier=payload['session']['id']
            self.assertEqual(self.api('POST','/sessions',role,body)[1]['session']['id'],identifier)
            first=self.api('PATCH',f'/sessions/{identifier}/end',role,{})[1]['session']
            self.assertEqual(self.api('PATCH',f'/sessions/{identifier}/end',role,{})[1]['session']['ended_at'],first['ended_at'])
            for denied in ('OTHER','PLATFORM_ADMIN'):
                self.assertEqual(self.api('PATCH',f'/sessions/{identifier}/end',denied,{})[0],403)
            self.assertEqual(self.api('DELETE',f'/sessions/extra/{identifier}',role)[0],404)
            self.assertIsNotNone(self.store.get_session(identifier))
        self.assertEqual(self.api('POST','/sessions','PLATFORM_ADMIN',{})[0],403)
        self.assertEqual(self.api('POST','/sessions','OTHER',{'user_id':member.id})[0],403)

    def test_profile_scope_and_account_revocation(self):
        profile=self.store.profile_for_user(self.users['MEMBER'].id)
        self.assertEqual(self.api('PATCH',f'/members/{profile.id}',body={'phone':'123'})[0],200)
        for role in ('OTHER','PLATFORM_ADMIN'):
            self.assertEqual(self.api('PATCH',f'/members/{profile.id}',role,{'phone':'456'})[0],403)
        self.assertEqual(self.api('PATCH',f'/members/{profile.id}',body={'reach_cm':180})[0],403)
        self.assertEqual(self.api('PATCH',f'/members/{profile.id}',body={'height_cm':True})[0],400)
        self.assertEqual(self.api('PATCH',f'/admin/accounts/{self.users["MEMBER"].id}','OWNER',{'status':'SUSPENDED'})[0],200)
        self.assertEqual(self.api('GET','/me')[0],401)
        self.assertEqual(self.api('POST','/auth/logout','COACH',{})[0],200)
        self.assertEqual(self.api('GET','/me','COACH')[0],401)

    def test_bad_signup_does_not_leave_a_center(self):
        count=len(self.store.gyms)
        body={'username':'newuser','password':'Synthetic!123','password_confirm':'Synthetic!123','name':{},'role':'OWNER','center_name':'New'}
        self.assertEqual(self.api('POST','/auth/signup',body=body)[0],400)
        self.assertEqual(len(self.store.gyms),count)
