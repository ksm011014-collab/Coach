# SQLite to Supabase Migration

This procedure preserves the source SQLite database and never imports local password hashes.

## Approval Boundary

The export and planning commands are local and read-only with respect to the source database. Creating Supabase Auth users, applying remote migrations, importing records, changing production data, or deleting migration files requires explicit production approval.

## 1. Freeze and Back Up

1. Stop writes to the source center database for the migration window.
2. Copy `backend/boxing_coach.db` to encrypted backup storage.
3. Record the source file size, modification time, and backup location.
4. Keep the original database read-only until acceptance is complete.

Do not operate directly on the only source copy.

## 2. Create a Password-Safe Export

From the project root:

```powershell
python tools\export_sqlite_bundle.py `
  --database backend\boxing_coach.db `
  --output migration-work\boxing-coach-export.json
```

The exporter removes `password_hash` and marks every account with `password_reset_required=true`.

The output contains personal data. Encrypt it at rest, restrict it to the migration operator, and do not commit it.

## 3. Validate References and Create Mapping Templates

```powershell
python tools\plan_sqlite_migration.py `
  --bundle migration-work\boxing-coach-export.json `
  --output migration-work\boxing-coach.migration-plan.json
```

The planner fails when it finds duplicate identifiers, duplicate usernames or center codes, password hashes, or broken center/account/profile/session references. It also creates mapping templates for legacy center, account, and profile IDs.

Do not proceed unless `valid` is `true` and every count matches the exporter output.

## 4. Stage the Import

Use a separate staging Supabase project with all migrations applied.

Import in this order:

1. Create centers through `platform_create_center` and fill each `center_mappings[].supabase_id`.
2. Recreate accounts with temporary unique passwords through the guarded administrator account-creation flow.
3. Fill each `account_mappings[].supabase_auth_id` and mark `temporary_password_issued=true`.
4. Import member profiles using the center and account mappings.
5. Fill each `profile_mappings[].supabase_id`.
6. Import calibrations using mapped profile, account, and center UUIDs.
7. Import training sessions using mapped account and center UUIDs.
8. Import coach labels using mapped session and account UUIDs.

Never insert local PBKDF2 password hashes into `auth.users`. Require a password change at first controlled handoff.

## 5. Verification Matrix

For every table, compare source and destination counts. Then sample at least one owner, coach, and member in each center.

- Center A actors cannot read or mutate center B records.
- Members can read only their own profile, calibration, and sessions.
- Coaches can read their center members but not another center.
- Center owners cannot manage another center's accounts.
- A downgraded coach loses center-wide access on the next request.
- Suspended accounts and suspended/expired centers lose access on the next request.
- `PLATFORM_ADMIN` can read operational summaries but cannot directly mutate training records.
- Audit logs contain center, subscription, feature, and account administration events.

Compare the legacy center assignment for every imported profile, calibration, session, and label. A matching total count is not enough if tenant ownership is wrong.

## 6. Production Cutover

1. Repeat the tested export and planning process during an approved write freeze.
2. Apply only migrations already validated in staging.
3. Import with the completed staging mapping procedure.
4. Run the full verification matrix before enabling customer access.
5. Keep the SQLite source and mapping files encrypted and read-only through the acceptance period.
6. Remove temporary migration exports only after written acceptance and according to the approved retention policy.

If verification fails, stop the cutover and follow `ROLLBACK_RUNBOOK.md`.
