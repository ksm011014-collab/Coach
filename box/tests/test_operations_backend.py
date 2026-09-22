import sqlite3
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend.domain import TrainingSession
from backend.errors import ApiError
from backend.operations import Operations
from backend.operations_schema import center_now
from fixtures import populated_store


class OperationsBackendTests(unittest.TestCase):
    def test_center_date_at_utc_year_boundary(self):
        instant = datetime(2025, 12, 31, 15, 30, tzinfo=timezone.utc)
        with patch('backend.operations_schema.datetime') as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            self.assertTrue(center_now(self.store.conn, self.owner.gym_id).startswith('2026-01-01T00:30'))
            self.store.conn.execute("insert into operation_centers(center_id,timezone) values(?,'UTC') on conflict(center_id) do update set timezone='UTC'", (self.owner.gym_id,))
            self.assertTrue(center_now(self.store.conn, self.owner.gym_id).startswith('2025-12-31T15:30'))

    def setUp(self):
        self.store = populated_store()
        self.owner = self.store.find_user_by_username('owner')
        self.member = self.store.find_user_by_username('member')
        self.service = Operations(self.store)
        self.service.now = lambda center_id: '2026-09-19T12:00:00+09:00'
        with self.store.transaction():
            self.store.conn.execute('update operation_members set joined_on=? where member_id=?', ('2026-01-01', self.member.id))
        self.counter = 0
        self.product = self.call('product.save', {'name': 'Test pass', 'kind': 'PERIOD', 'days': 30, 'count': 0, 'price': 10000})

    def tearDown(self):
        self.store.conn.close()

    def call(self, operation, values, actor=None, key=None):
        self.counter += 1
        return self.service.mutate(actor or self.owner, operation, values, key or f'request-{self.counter}')

    def test_member_pass_registration_atomic_and_response_loss_retry(self):
        values = {'name': 'New test member', 'username': 'newmember', 'password': 'Test!12345', 'password_confirm': 'Test!12345', 'product_id': 'missing'}
        with self.assertRaises(ApiError):
            self.call('member.create', values, key='register')
        self.assertIsNone(self.store.find_user_by_username('newmember'))
        values['product_id'] = self.product['id']
        created = self.call('member.create', values, key='register')
        self.assertEqual(created, self.call('member.create', values, key='register'))
        self.assertEqual(created['pass']['member_id'], created['id'])
        with self.assertRaises(ApiError):
            self.call('member.create', {**values, 'name': 'Different'}, key='register')
        serialized = ' '.join(str(tuple(row)) for row in self.store.conn.execute('select * from operation_requests'))
        self.assertNotIn(values['password'], serialized)

    def test_member_edit_and_expiry_are_atomic_and_preserve_registration(self):
        assigned = self.call('pass.assign', {'member_id': self.member.id, 'product_id': self.product['id'], 'start_on': '2026-09-01', 'end_on': '2026-09-30', 'reason': 'Synthetic'})
        values = {'id': self.member.id, 'version': 1, 'name': 'Edited', 'height_cm': 180, 'weight_kg': 80, 'training_level': 3, 'stance': 'southpaw', 'injury_note': 'Profile memo', 'pass_id': assigned['id'], 'pass_version': 1, 'end_on': '2026-09-20', 'reason': 'Correct expiry'}
        result = self.call('member.update', values, key='expiry-edit')
        self.assertEqual(self.call('member.update', values, key='expiry-edit'), result)
        self.assertEqual(result['joined_on'], '2026-01-01')
        snapshot = self.service.snapshot(self.owner)
        self.assertEqual(snapshot['passes'][0]['end_on'], '2026-09-20')
        self.assertEqual(sum(row['action'] == 'SET_END' for row in snapshot['passes'][0]['history']), 1)
        with self.assertRaises(ApiError):
            self.call('member.update', {**values, 'version': 2, 'name': 'Must rollback', 'end_on': '2026-10-01'})
        self.assertEqual(self.store.profile_for_user(self.member.id).name, 'Edited')
        with self.assertRaises(ValueError):
            self.call('member.update', {**values, 'version': 2, 'pass_version': 2, 'end_on': '2026-08-31'})

    def test_easy_payment_methods_preserve_receipt_and_refund(self):
        for method in ('KAKAOPAY', 'EASY_PAY'):
            receipt = self.call('payment.register', {'member_id': self.member.id, 'product_id': self.product['id'], 'amount': 10000, 'method': method, 'status': 'PAID', 'paid_on': '2026-09-01'})
            self.assertEqual(receipt['method'], method)
            self.call('payment.adjust', {'id': receipt['id'], 'version': 1, 'action': 'REFUND', 'amount': 4000, 'on': '2026-09-19', 'reason': 'Synthetic'})
        self.assertEqual(self.service.snapshot(self.owner)['revenue'][-1]['net'], 12000)

    def test_expiry_requires_selected_pass_and_changes_only_that_pass(self):
        with self.assertRaises(ValueError):
            self.call('member.update', {'id': self.member.id, 'version': 1, 'name': 'Invalid', 'end_on': '2026-10-31'})
        self.assertEqual(self.service.snapshot(self.owner)['passes'], [])
        first = self.call('pass.assign', {'member_id': self.member.id, 'product_id': self.product['id'], 'start_on': '2026-09-01', 'end_on': '2026-09-30', 'reason': 'First synthetic pass'})
        second = self.call('pass.assign', {'member_id': self.member.id, 'product_id': self.product['id'], 'start_on': '2026-10-01', 'end_on': '2026-10-30', 'reason': 'Second synthetic pass'})
        self.call('member.update', {'id': self.member.id, 'version': 1, 'name': 'Edited', 'pass_id': second['id'], 'pass_version': 1, 'end_on': '2026-11-15', 'reason': 'Extend selected pass'})
        passes = {row['id']: row for row in self.service.snapshot(self.owner)['passes']}
        self.assertEqual(passes[first['id']]['end_on'], '2026-09-30')
        self.assertEqual(passes[second['id']]['end_on'], '2026-11-15')
        self.assertEqual(sum(row['action'] == 'SET_END' for row in passes[second['id']]['history']), 1)

    def test_center_details_role_version_and_retry(self):
        initial = self.service.snapshot(self.owner)['center']
        self.assertEqual(initial['version'], 0)
        values = {'id': self.owner.gym_id, 'version': 0, 'phone': '010-0000-0000', 'address': 'Synthetic address', 'weekday_hours': '09:00–22:00', 'weekend_hours': '10:00–18:00'}
        saved = self.call('center.save', values, key='center-save')
        self.assertEqual(saved, self.call('center.save', values, key='center-save'))
        self.assertEqual(self.service.snapshot(self.member)['center']['address'], values['address'])
        with self.assertRaises(PermissionError):
            self.call('center.save', {**values, 'version': 1}, actor=self.member)
        with self.assertRaises(ApiError):
            self.call('center.save', {**values, 'phone': 'stale'})
        with self.assertRaises(PermissionError):
            self.call('center.save', {**values, 'id': 'another-center', 'version': 1})

    def test_soft_delete_preserves_visits_payments_sessions_and_revokes_login(self):
        visit = self.call('attendance.mark', {'member_id': self.member.id, 'visited_on': '2026-09-18', 'reason': 'test'})
        payment = self.call('payment.register', {'member_id': self.member.id, 'product_id': self.product['id'], 'amount': 10000, 'method': 'CARD', 'status': 'PAID', 'paid_on': '2026-09-18'})
        self.store.create_session(TrainingSession('test-session', self.member.id, self.member.gym_id, 1, 2, [], 0, 'test'))
        self.call('member.delete', {'id': self.member.id, 'version': 1, 'reason': 'synthetic deletion'})
        account = self.store.get_user(self.member.id)
        self.assertEqual(account.status, 'SUSPENDED')
        self.assertGreater(account.token_version, self.member.token_version)
        result = self.service.snapshot(self.owner, '2026-09-18')
        self.assertEqual(result['roster']['present'], 1)
        self.assertEqual(result['payments'][0]['id'], payment['id'])
        self.assertEqual(result['attendance'][0]['id'], visit['id'])
        self.assertIsNotNone(self.store.conn.execute('select id from training_sessions where id=?', ('test-session',)).fetchone())
        self.assertEqual(self.service.snapshot(self.owner)['roster']['total'], 0)
        with self.assertRaises(PermissionError):
            self.service.snapshot(self.member)

    def test_permissions_versions_and_tenant_foreign_keys(self):
        other_center = self.store.create_gym('Other')
        other = self.store.create_user('otherowner', 'Other!12345', 'CENTER_OWNER', 'Other', other_center.id)
        coach = self.store.create_user('testcoach', 'Coach!12345', 'COACH', 'Coach', self.owner.gym_id)
        for actor in (coach, self.member):
            with self.assertRaises(PermissionError):
                self.call('product.save', {'name': 'Rejected'}, actor)
        with self.assertRaises(ApiError):
            self.call('pass.assign', {'member_id': self.member.id, 'product_id': self.product['id'], 'start_on': '2026-09-01', 'reason': 'test'}, other)
        changed = self.call('product.save', {**self.product, 'price': 20000})
        self.assertEqual(changed['version'], 2)
        with self.assertRaises(ApiError):
            self.call('product.save', {**self.product, 'price': 30000})
        self.assertEqual(self.service.snapshot(other)['products'], [])

    def test_duplicate_attendance_refunds_and_member_private_snapshot(self):
        values = {'member_id': self.member.id, 'visited_on': '2026-09-18', 'reason': 'test'}
        visit = self.call('attendance.mark', values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.call('attendance.mark', values)
        self.call('attendance.cancel', {'id': visit['id'], 'version': 1, 'reason': 'test'})
        self.call('attendance.mark', values)
        payment = self.call('payment.register', {'member_id': self.member.id, 'product_id': self.product['id'], 'amount': 100, 'status': 'PAID', 'method': 'CASH', 'paid_on': '2026-08-01'})
        refund = {'id': payment['id'], 'version': 1, 'action': 'REFUND', 'amount': 40, 'on': '2026-09-01', 'reason': 'test'}
        self.call('payment.adjust', refund)
        with self.assertRaises(ValueError):
            self.call('payment.adjust', {**refund, 'version': 2, 'amount': 61})
        self.call('payment.adjust', {**refund, 'version': 2, 'amount': 60})
        self.call('note.add', {'member_id': self.member.id, 'content': 'Staff only'})
        result = self.service.snapshot(self.member)
        self.assertEqual(result['notes'], [])
        self.assertEqual([row['id'] for row in result['members']], [self.member.id])
        self.assertEqual(result['revenue'][-2]['net'], 100)
        self.assertEqual(result['revenue'][-1]['net'], -100)

    def test_member_update_registration_correction_and_stale_write(self):
        values = {'id': self.member.id, 'version': 1, 'name': 'Corrected name', 'joined_on': '2025-12-01', 'reason': 'Verified registration form'}
        updated = self.call('member.update', values, key='update-member')
        self.assertEqual(updated['version'], 2)
        self.assertEqual(self.call('member.update', values, key='update-member'), updated)
        with self.assertRaises(ApiError):
            self.call('member.update', {**values, 'name': 'Stale'})
        self.call('attendance.mark', {'member_id': self.member.id, 'visited_on': '2026-01-01', 'reason': 'test'})
        with self.assertRaises(ApiError):
            self.call('member.update', {**values, 'version': 2, 'joined_on': '2026-02-01'})
        self.assertEqual(self.service.snapshot(self.owner)['members'][0]['name'], 'Corrected name')

    def test_legacy_profile_write_invalidates_version_and_deleted_profile_is_read_only(self):
        profile = self.store.profile_for_user(self.member.id)
        self.store.patch_profile(self.owner, profile.id, {'phone': '010-0000-2222'})
        with self.assertRaises(ApiError):
            self.call('member.update', {'id': self.member.id, 'version': 1, 'phone': 'stale'})
        self.call('member.delete', {'id': self.member.id, 'version': 2, 'reason': 'Synthetic'})
        with self.assertRaises(PermissionError):
            self.store.patch_profile(self.owner, profile.id, {'phone': 'forbidden'})
        with self.assertRaises(ValueError):
            self.store.update_account(self.owner, self.member.id, {'status': 'ACTIVE'})
