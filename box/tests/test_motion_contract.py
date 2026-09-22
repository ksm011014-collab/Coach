import unittest

from backend.runtime_contract import capabilities


class MotionContractTests(unittest.TestCase):
    def test_report_storage_is_distinct_from_server_inference(self):
        for local, mode in ((True, 'local'), (True, 'supabase'), (False, 'supabase')):
            with self.subTest(local=local, mode=mode):
                contract = capabilities(mode, local=local)
                self.assertEqual(contract['motion_reports']['versions'], [1])
                self.assertEqual(contract['motion_reports']['source'], 'device_estimate')
                self.assertFalse(contract['analysis']['available'])
