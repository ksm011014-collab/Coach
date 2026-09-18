import unittest
from email.message import Message
from unittest.mock import patch
from backend.runtime_contract import request_origin_allowed


class HttpBoundaryTests(unittest.TestCase):
    def test_invalid_configuration_fails_closed(self):
        for origin in ('http://[broken', 'http://localhost:bad', 'https://user:pass@example.test', 'https://example.test/path'):
            with patch.dict('os.environ', {'BOXING_COACH_ALLOWED_ORIGINS': origin}):
                self.assertFalse(request_origin_allowed({'Host':'localhost:8000'},8000))

    def test_explicit_origin_and_duplicate_headers(self):
        with patch.dict('os.environ', {'BOXING_COACH_ALLOWED_ORIGINS':'https://app.example.test'}):
            self.assertTrue(request_origin_allowed({'Host':'app.example.test','Origin':'https://app.example.test'},8000))
            self.assertFalse(request_origin_allowed({'Host':'app.example.test','Origin':'null'},8000))
            for key in ('Host','Origin'):
                headers=Message()
                headers['Host']='app.example.test'
                headers['Origin']='https://app.example.test'
                headers[key]=headers[key]
                self.assertFalse(request_origin_allowed(headers,8000))
