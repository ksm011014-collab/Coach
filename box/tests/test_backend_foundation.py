import base64
import dataclasses
import hashlib
import hmac
import json
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from backend.domain import (
    SECRET, MigrationRequired, Store, TrainingSession, can_read_profile,
    can_read_session, can_write_training, read_token, sign_token, verify_password,
)
from fixtures import populated_store
from tools.migrate_sqlite import upgrade_database


class DatabaseFoundationTests(unittest.TestCase):
    def test_old_role_schema_upgrade_preserves_all_history_and_passwords(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, backup = Path(temporary) / "old.db", Path(temporary) / "backup.db"
            store = populated_store(path)
            member = store.find_user_by_username("member")
            owner = store.find_user_by_username("owner")
            profile = store.profile_for_user(member.id)
            store.create_session(TrainingSession("old-session", member.id, member.gym_id, 1, 2, [], 87,
                                                 "legacy", feedback_report='{"legacy":"preserve"}'))
            with store.transaction():
                store.conn.execute("insert into member_calibrations values(?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("old-calibration",profile.id,member.id,member.gym_id,"complete",1,2,10,175,"[]","{}",'{"old":true}'))
                store.conn.execute("insert into coach_labels values(?,?,?,?,?,?,?)",
                    ("old-label","old-session",owner.id,"old","preserve",1,3))
            store.conn.execute("pragma foreign_keys=off")
            with store.transaction():
                store.conn.execute("""create table legacy_users (
                    id text primary key, gym_id text not null references gyms(id), username text not null unique,
                    email text not null default '', password_hash text not null,
                    role text not null check(role in ('OWNER','MEMBER')), name text not null)""")
                store.conn.execute("insert into legacy_users select id,gym_id,username,email,password_hash,role,name from users")
                store.conn.execute("drop table users")
                store.conn.execute("alter table legacy_users rename to users")
                store.conn.execute("pragma user_version=0")
            tables = ("gyms","users","member_profiles","member_calibrations","training_sessions","coach_labels")
            columns = {table:[row[1] for row in store.conn.execute(f"pragma table_info({table})")] for table in tables}
            before = {table:store.conn.execute(f"select * from {table} order by id").fetchall() for table in tables}
            before = {table:[tuple(row) for row in rows] for table,rows in before.items()}
            store.conn.close()
            upgrade_database(path, backup)
            with closing(sqlite3.connect(path)) as upgraded, closing(sqlite3.connect(backup)) as saved:
                for table in tables:
                    query = f"select {','.join(columns[table])} from {table} order by id"
                    self.assertEqual(upgraded.execute(query).fetchall(), before[table], table)
                    self.assertEqual(saved.execute(query).fetchall(), before[table], table)
                self.assertEqual(upgraded.execute("pragma foreign_key_check").fetchall(), [])
                self.assertEqual(saved.execute("pragma user_version").fetchone()[0], 0)
            reopened = Store(path)
            try:
                self.assertTrue(verify_password("Member!123", reopened.get_user(member.id).password_hash))
                self.assertEqual(reopened.create_user("coach_new", "Coach!123", "COACH", "Coach", member.gym_id).role,"COACH")
            finally:
                reopened.conn.close()

    def test_failed_upgrade_rolls_back_and_keeps_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, backup = Path(temporary) / "old.db", Path(temporary) / "backup.db"
            store = populated_store(path)
            with closing(store.conn):
                store.conn.execute("pragma foreign_keys=off")
                with store.transaction():
                    store.conn.execute("update member_profiles set user_id='missing-' || user_id")
                    store.conn.execute("pragma user_version=0")
                before = list(store.conn.iterdump())
            with self.assertRaisesRegex(ValueError,"foreign keys"):
                upgrade_database(path,backup)
            with closing(sqlite3.connect(path)) as unchanged, closing(sqlite3.connect(backup)) as saved:
                self.assertEqual(list(unchanged.iterdump()),before)
                self.assertEqual(list(saved.iterdump()),before)

    def test_new_database_has_no_fixed_accounts(self):
        store = Store()
        self.addCleanup(store.conn.close)
        self.assertEqual(store.users, {})
        self.assertEqual(store.gyms, {})

    def test_reopening_does_not_reset_password_or_create_accounts(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "test.db"
            store = populated_store(path)
            before = [tuple(row) for row in store.conn.execute("select * from users order by id")]
            store.conn.close()
            reopened = Store(path)
            self.assertEqual([tuple(row) for row in reopened.conn.execute("select * from users order by id")], before)
            reopened.conn.close()

    def test_legacy_database_requires_explicit_backup_and_preserves_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "legacy.db"
            backup = Path(temporary) / "backup.db"
            store = populated_store(path)
            before = [tuple(row) for row in store.conn.execute("select * from users order by id")]
            store.conn.execute("pragma user_version = 0")
            store.conn.close()
            original_bytes = path.read_bytes()
            with self.assertRaises(MigrationRequired):
                Store(path)
            self.assertEqual(path.read_bytes(), original_bytes)
            upgrade_database(path, backup)
            reopened = Store(path)
            try:
                self.assertEqual([tuple(row) for row in reopened.conn.execute("select * from users order by id")], before)
                with closing(sqlite3.connect(backup)) as saved:
                    self.assertEqual(saved.execute("pragma user_version").fetchone()[0], 0)
                    self.assertEqual(saved.execute("select * from users order by id").fetchall(), before)
            finally:
                reopened.conn.close()

    def test_nested_transactions_roll_back_all_records(self):
        store = Store()
        self.addCleanup(store.conn.close)
        with self.assertRaises(ValueError):
            with store.transaction():
                center = store.create_gym("Temporary Center", "temporary")
                store.create_user("owner", "Owner!123", "OWNER", "Test", center.id)
                raise ValueError("profile failed")
        self.assertEqual(store.users, {})
        self.assertEqual(store.gyms, {})

    def test_foreign_keys_are_enabled(self):
        store = Store()
        self.addCleanup(store.conn.close)
        with self.assertRaises(sqlite3.IntegrityError):
            store.conn.execute("insert into users (id,gym_id,username,password_hash,role,name) values ('u','missing','user','hash','MEMBER','Test')")

    def test_start_request_is_idempotent_and_end_time_is_stable(self):
        store = populated_store()
        self.addCleanup(store.conn.close)
        member = store.find_user_by_username("member")
        first = TrainingSession("session-a", member.id, member.gym_id, 10, None, [], 0,
                                "free_training", created_by=member.id, request_id="same-request")
        second = dataclasses.replace(first, id="session-b", started_at=11)
        self.assertEqual(store.create_session(first).id, store.create_session(second).id)
        with self.assertRaises(ValueError):
            store.create_session(dataclasses.replace(second, focus="different"))
        self.assertEqual(len(store.sessions), 1)
        store.end_session(first.id, 20)
        self.assertEqual(store.end_session(first.id, 30).ended_at, 20)


class AuthorizationFoundationTests(unittest.TestCase):
    def setUp(self):
        self.store = populated_store()
        self.addCleanup(self.store.conn.close)
        self.member = self.store.find_user_by_username("member")
        self.profile = self.store.profile_for_user(self.member.id)

    def test_profile_patch_enforces_role_and_validates_fields(self):
        owner = self.store.find_user_by_username("owner")
        changed = self.store.patch_profile(self.member, self.profile.id, {"phone": "123"})
        self.assertEqual(changed.phone, "123")
        for field in ("reach_cm", "training_level"):
            with self.assertRaises(PermissionError):
                self.store.patch_profile(self.member, self.profile.id, {field: 2})
        for patch in ({"name": " "}, {"phone": None}, {"height_cm": True}, {"weight_kg": -1}, {"birthdate": "2026-02-30"}, {"gym_id": "other"}):
            with self.assertRaises(ValueError):
                self.store.patch_profile(owner, self.profile.id, patch)
        self.assertEqual(self.store.get_profile(self.profile.id), changed)
        updated = self.store.patch_profile(owner, self.profile.id, {"reach_cm": 180, "training_level": 3})
        self.assertEqual(updated.training_level, 3)
        platform = self.store.create_user("platform", "Platform!123", "PLATFORM_ADMIN", "Platform", owner.gym_id)
        own_profile = self.store.create_profile(platform, "", "", "")
        with self.assertRaises(PermissionError):
            self.store.patch_profile(platform, own_profile.id, {"phone": "123"})

    def test_account_admin_scopes_and_audit_are_atomic(self):
        owner = self.store.find_user_by_username("owner")
        other_center = self.store.create_gym("Other Center", "other-center")
        other = self.store.create_user("other_member", "Other!123", "MEMBER", "Other", other_center.id)
        payload = {"username": "new_coach", "password": "Coach!123", "role": "COACH", "name": "Coach"}
        created = self.store.create_managed_account(owner, payload)
        self.assertEqual(created.gym_id, owner.gym_id)
        self.assertIsNotNone(self.store.profile_for_user(created.id))
        self.assertEqual(self.store.conn.execute("select count(*) from account_audit_logs").fetchone()[0], 1)
        for actor, target, patch in (
            (owner, other, {"status": "SUSPENDED"}),
            (owner, self.member, {"role": "PLATFORM_ADMIN"}),
            (owner, owner, {"status": "SUSPENDED"}),
            (created, self.member, {"status": "SUSPENDED"}),
            (self.member, self.member, {"role": "COACH"}),
        ):
            with self.assertRaises(PermissionError):
                self.store.update_account(actor, target.id, patch)
        self.assertEqual(self.store.conn.execute("select count(*) from account_audit_logs").fetchone()[0], 1)
        self.assertEqual(self.store.get_user(other.id), other)
        with self.assertRaises(PermissionError):
            self.store.create_managed_account(owner, {**payload, "username": "cross_coach", "center_id": other_center.id})
        self.assertIsNone(self.store.find_user_by_username("cross_coach"))

    def test_access_changes_revoke_tokens_and_log_only_access_state(self):
        owner = self.store.find_user_by_username("owner")
        updated = self.store.update_account(owner, self.member.id, {"status": "SUSPENDED"})
        self.assertEqual(updated.token_version, self.member.token_version + 1)
        self.assertEqual(updated.status, "SUSPENDED")
        same = self.store.update_account(owner, updated.id, {"status": "SUSPENDED"})
        self.assertEqual(same.token_version, updated.token_version)
        audit = self.store.conn.execute("select * from account_audit_logs").fetchall()
        self.assertEqual(len(audit), 1)
        for field in ("before_state", "after_state"):
            self.assertEqual(set(json.loads(audit[0][field])), {"role", "status", "token_version"})
        self.store.revoke_tokens(owner.id)
        with self.assertRaises(PermissionError):
            self.store.update_account(owner, self.member.id, {"status": "ACTIVE"})

    def test_platform_can_manage_accounts_but_not_training(self):
        platform = self.store.create_user("platform", "Platform!123", "PLATFORM_ADMIN", "Platform", self.member.gym_id)
        updated = self.store.update_account(platform, self.member.id, {"role": "COACH"})
        self.assertEqual(updated.role, "COACH")
        self.assertFalse(can_write_training(platform, self.profile))

    def test_all_roles_have_explicit_read_and_write_scope(self):
        for role in ("OWNER", "CENTER_OWNER", "COACH", "PLATFORM_ADMIN", "MEMBER"):
            actor = dataclasses.replace(self.member, role=role)
            self.assertTrue(can_read_profile(actor, self.profile), role)
            self.assertEqual(can_write_training(actor, self.profile), role != "PLATFORM_ADMIN", role)
            outsider = dataclasses.replace(actor, id="other-user", gym_id="other-center")
            self.assertEqual(can_read_profile(outsider, self.profile), role == "PLATFORM_ADMIN", role)
            self.assertFalse(can_write_training(outsider, self.profile), role)
            self.assertFalse(can_read_profile(dataclasses.replace(actor, status="SUSPENDED"), self.profile), role)
        other_member = dataclasses.replace(self.member, id="different-member")
        self.assertFalse(can_read_profile(other_member, self.profile))

    def test_valid_and_malformed_tokens(self):
        self.assertEqual(read_token(sign_token(self.member))["ver"], 1)
        for payload in ([], {}, {"sub": "u", "exp": float("nan"), "ver": 1},
                        {"sub": "u", "exp": time.time() - 1, "ver": 1},
                        {"sub": "u", "exp": time.time() + 60}):
            raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
            signature = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
            with self.assertRaises(PermissionError):
                read_token(raw + "." + signature)
        for token in ("", "broken", "a.b", "x" * 5000):
            with self.assertRaises(PermissionError):
                read_token(token)
        self.assertFalse(verify_password("password", "malformed"))


if __name__ == "__main__":
    unittest.main()
