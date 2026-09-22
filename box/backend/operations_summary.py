from __future__ import annotations

from datetime import date


def attendance_roster(members, attendance, selected_on: str, today: str):
    selected = date.fromisoformat(selected_on)
    current = date.fromisoformat(today)
    present = {row['member_id'] for row in attendance
               if row['visited_on'] == selected_on and row['status'] == 'PRESENT'}
    rows = []
    unknown = 0
    for member in members:
        joined_on = member.get('joined_on')
        if not joined_on:
            unknown += 1
            continue
        deleted_on = member.get('deleted_on')
        if date.fromisoformat(joined_on) > selected:
            continue
        if deleted_on and date.fromisoformat(deleted_on) <= selected:
            continue
        status = 'UPCOMING' if selected > current else (
            'PRESENT' if member['id'] in present else 'ABSENT')
        rows.append({**member, 'attendance_status': status})
    return {
        'date': selected_on,
        'members': rows,
        'total': len(rows),
        'present': sum(row['attendance_status'] == 'PRESENT' for row in rows),
        'absent': sum(row['attendance_status'] == 'ABSENT' for row in rows),
        'unknown_registration_count': unknown,
    }


def revenue_months(payments, reference_on: str):
    reference = date.fromisoformat(reference_on)
    month_number = reference.year * 12 + reference.month - 1
    buckets = {}
    for offset in range(5, -1, -1):
        year, month = divmod(month_number - offset, 12)
        key = f'{year:04d}-{month + 1:02d}'
        buckets[key] = {'month': key, 'collected': 0, 'refunded': 0, 'net': 0}

    def add(on, field, amount):
        if on and date.fromisoformat(on) <= reference and on[:7] in buckets:
            buckets[on[:7]][field] += amount

    for payment in payments:
        paid_on = payment.get('paid_on')
        if not paid_on:
            continue
        add(paid_on, 'collected', payment['amount'])
        for adjustment in payment.get('adjustments', []):
            if adjustment['action'] == 'REFUND':
                add(adjustment['on'], 'refunded', adjustment['amount'])
            elif adjustment['action'] == 'CANCEL':
                add(adjustment['on'], 'refunded', payment['amount'])
    for bucket in buckets.values():
        bucket['net'] = bucket['collected'] - bucket['refunded']
    return list(buckets.values())
