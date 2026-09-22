import unittest

from backend.operations_summary import attendance_roster, revenue_months


class OperationsSummaryTests(unittest.TestCase):
    def test_historical_roster_preserves_deleted_member_and_unknown_dates(self):
        members = [
            {'id': 'old', 'joined_on': '2025-12-01', 'deleted_on': '2026-01-03'},
            {'id': 'new', 'joined_on': '2026-01-02'},
            {'id': 'unknown', 'joined_on': None},
        ]
        visits = [{'member_id': 'old', 'visited_on': '2026-01-01', 'status': 'PRESENT'}] * 2
        result = attendance_roster(members, visits, '2026-01-01', '2026-01-04')
        self.assertEqual((result['total'], result['present'], result['absent']), (1, 1, 0))
        self.assertEqual(result['unknown_registration_count'], 1)
        result = attendance_roster(members, visits, '2026-01-03', '2026-01-04')
        self.assertEqual([row['id'] for row in result['members']], ['new'])
        self.assertEqual(result['absent'], 1)

    def test_future_roster_is_not_absence_and_empty_roster_is_valid(self):
        result = attendance_roster([{'id': 'member', 'joined_on': '2026-01-01'}], [], '2026-02-01', '2026-01-01')
        self.assertEqual(result['members'][0]['attendance_status'], 'UPCOMING')
        self.assertEqual(result['absent'], 0)
        self.assertEqual(attendance_roster([], [], '2026-01-01', '2026-01-01')['total'], 0)

    def test_refunds_stay_in_occurrence_month_across_year_boundary(self):
        payments = [
            {'amount': 100000, 'paid_on': '2025-12-10', 'adjustments': [
                {'action': 'REFUND', 'amount': 30000, 'on': '2026-01-01'},
                {'action': 'REFUND', 'amount': 70000, 'on': '2026-02-01'},
            ]},
            {'amount': 50000, 'paid_on': None, 'adjustments': []},
            {'amount': 20000, 'paid_on': '2026-01-01', 'adjustments': [
                {'action': 'CANCEL', 'amount': 0, 'on': '2026-01-02'},
            ]},
        ]
        result = revenue_months(payments, '2026-01-31')
        self.assertEqual([row['month'] for row in result], ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'])
        self.assertEqual([row['net'] for row in result], [0, 0, 0, 0, 100000, -30000])
        result = revenue_months(payments, '2026-02-01')
        self.assertEqual(result[-1]['net'], -70000)

    def test_refund_from_payment_outside_chart_window_is_included(self):
        result = revenue_months([{'amount': 100, 'paid_on': '2020-01-01', 'adjustments': [
            {'action': 'REFUND', 'amount': 100, 'on': '2026-01-01'},
        ]}], '2026-01-01')
        self.assertEqual(result[-1]['net'], -100)
