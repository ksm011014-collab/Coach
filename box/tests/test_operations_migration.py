import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from backend.domain import MigrationRequired, Store
from fixtures import populated_store
from tools.migrate_sqlite import upgrade_database


class OperationsMigrationTests(unittest.TestCase):
    def test_version_two_upgrade_preserves_payment_adjustments_and_history(self):
        from backend.operations import Operations
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'synthetic.db'
            backup = Path(temporary) / 'backup.db'
            store = populated_store(path)
            owner = store.find_user_by_username('owner')
            member = store.find_user_by_username('member')
            service = Operations(store)
            product = service.mutate(owner, 'product.save', {'name': 'Synthetic', 'kind': 'PERIOD', 'days': 30, 'count': 0, 'price': 100}, 'product')
            payment = service.mutate(owner, 'payment.register', {'member_id': member.id, 'product_id': product['id'], 'amount': 100, 'method': 'CARD', 'status': 'PAID', 'paid_on': '2026-01-01'}, 'payment')
            service.mutate(owner, 'payment.adjust', {'id': payment['id'], 'version': 1, 'action': 'REFUND', 'amount': 40, 'on': '2026-01-02', 'reason': 'Synthetic'}, 'refund')
            service.mutate(owner, 'pass.assign', {'member_id': member.id, 'product_id': product['id'], 'start_on': '2026-01-01', 'reason': 'Synthetic'}, 'pass')
            before = {table: [tuple(row) for row in store.conn.execute('select * from ' + table + ' order by id')] for table in ('users', 'operation_payments', 'operation_adjustments', 'operation_pass_history')}
            store.conn.close()
            with closing(sqlite3.connect(path)) as connection:
                with connection:
                    for table in ('operation_payments', 'operation_pass_history'):
                        sql = connection.execute('select sql from sqlite_master where name=?', (table,)).fetchone()[0]
                        sql = sql.replace(",'KAKAOPAY','EASY_PAY'", '').replace(",'SET_END'", '')
                        connection.execute(sql.replace(table, table + '_old', 1))
                        connection.execute('insert into ' + table + '_old select * from ' + table)
                        connection.execute('drop table ' + table)
                        connection.execute('alter table ' + table + '_old rename to ' + table)
                    connection.execute('pragma user_version=2')
            with self.assertRaises(MigrationRequired):
                Store(path)
            self.assertTrue(upgrade_database(path, backup))
            store = Store(path)
            try:
                for table, rows in before.items():
                    self.assertEqual([tuple(row) for row in store.conn.execute('select * from ' + table + ' order by id')], rows)
                self.assertFalse(store.conn.execute('pragma foreign_key_check').fetchall())
                self.assertIn('KAKAOPAY', store.conn.execute("select sql from sqlite_master where name='operation_payments'").fetchone()[0])
            finally:
                store.conn.close()
            with closing(sqlite3.connect(backup)) as connection:
                self.assertEqual(connection.execute('pragma user_version').fetchone()[0], 2)

    def test_version_one_requires_explicit_upgrade_and_preserves_accounts(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'synthetic.db'
            backup = Path(temporary) / 'backup.db'
            store = populated_store(path)
            before = [tuple(row) for row in store.conn.execute('select * from users order by id')]
            with store.transaction():
                tables = [row[0] for row in store.conn.execute("select name from sqlite_master where type='table' and name like 'operation_%' order by rowid desc")]
                for table in tables:
                    store.conn.execute('drop table "' + table + '"')
                store.conn.execute('pragma user_version=1')
            store.conn.close()
            with self.assertRaises(MigrationRequired):
                Store(path)
            self.assertTrue(upgrade_database(path, backup))
            store = Store(path)
            try:
                self.assertEqual([tuple(row) for row in store.conn.execute('select * from users order by id')], before)
                member = store.conn.execute('select * from operation_members').fetchone()
                self.assertIsNone(member['joined_on'])
                self.assertFalse(store.conn.execute('pragma foreign_key_check').fetchall())
            finally:
                store.conn.close()
            with closing(sqlite3.connect(backup)) as connection:
                self.assertEqual(connection.execute('pragma user_version').fetchone()[0], 1)
                self.assertEqual(connection.execute('select count(*) from users').fetchone()[0], len(before))

    def test_cross_center_product_relationship_and_duplicate_attendance_rejected(self):
        store = populated_store()
        try:
            member = store.find_user_by_username('member')
            other_center = store.create_gym('Other synthetic center')
            with store.transaction():
                store.conn.execute('insert or ignore into operation_members(member_id,center_id) values(?,?)', (member.id, member.gym_id))
                store.conn.execute('insert into operation_products values(?,?,?,?,?,?,?,?)', ('product', other_center.id, 'Period', 'PERIOD', 30, 0, 100, 1))
            with self.assertRaises(sqlite3.IntegrityError), store.transaction():
                store.conn.execute('insert into operation_passes values(?,?,?,?,?,?,?,?,?)', ('pass', member.gym_id, member.id, 'product', '2026-01-01', '2026-02-01', None, 'ACTIVE', 1))
            with store.transaction():
                store.conn.execute('insert into operation_attendance values(?,?,?,?,?,?,?,?,?)', ('visit', member.gym_id, member.id, '2026-01-01', 'PRESENT', 'test', '2026-01-01T12:00:00+09:00', None, 1))
            with self.assertRaises(sqlite3.IntegrityError), store.transaction():
                store.conn.execute('insert into operation_attendance values(?,?,?,?,?,?,?,?,?)', ('duplicate', member.gym_id, member.id, '2026-01-01', 'PRESENT', 'test', '2026-01-01T12:00:00+09:00', None, 1))
        finally:
            store.conn.close()
