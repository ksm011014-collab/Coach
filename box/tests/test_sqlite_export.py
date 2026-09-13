import tempfile
import unittest
from pathlib import Path

from backend.domain import Store
from tools.export_sqlite_bundle import export_bundle


class SqliteExportTests(unittest.TestCase):
    def test_export_omits_password_hashes_and_decodes_json(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "boxing_coach.db"
            store = Store(database)
            store.conn.close()

            bundle = export_bundle(database)

        self.assertEqual(bundle["password_migration"], "reset_required")
        self.assertGreaterEqual(len(bundle["tables"]["users"]), 2)
        self.assertNotIn("password_hash", bundle["tables"]["users"][0])
        self.assertTrue(bundle["tables"]["users"][0]["password_reset_required"])
