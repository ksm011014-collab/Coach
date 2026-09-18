# Central account and data plane

BoxingCoach keeps camera capture and recordings on the customer device. The previous analysis engine and its application endpoints have been removed. Supabase stores identity, account status, roles, centers, subscriptions, feature flags, member profiles, legacy calibration data, session summaries, and administrative audit events.

## Security model

- `PLATFORM_ADMIN` can manage accounts, centers, subscriptions, and feature rollout, and can read operational data without direct training-record mutation by default.
- `CENTER_OWNER` can manage `COACH` and `MEMBER` accounts in the same center.
- `COACH` can access member profiles and training sessions in the same center.
- `MEMBER` can access only their own profile, calibration, and sessions.
- Every data policy calls `account_is_active()`, so suspending an account, center, or subscription takes effect on its next request even if its access token has not expired.
- Account access changes increment `token_version` and append an immutable audit record.
- The service role key is used only inside `admin-create-user`; it must never be copied into the desktop package or `.env` file.

## Project setup

1. Create a Supabase project.
2. Apply every file in `migrations` in filename order with the Supabase CLI or SQL editor. The profile/calibration migrations and platform-operations migration are all required for production.
3. Deploy `admin-create-user` with JWT verification enabled. `SUPABASE_SERVICE_ROLE_KEY` remains an Edge Function secret and is never sent to the client.
4. Bootstrap the first platform administrator in a staging project with a temporary center. First create the temporary center in the SQL editor:

   ```sql
   insert into public.centers(name, code)
   values ('Platform Bootstrap', 'platform-bootstrap');
   ```

   Sign up once as a `MEMBER` with center code `platform-bootstrap`, then promote that account and remove the temporary member data:

   ```sql
   begin;
   delete from public.member_profiles
   where user_id = (select id from public.accounts where username = 'YOUR_USERNAME');
   update public.accounts
   set role = 'PLATFORM_ADMIN', center_id = null, token_version = token_version + 1
   where username = 'YOUR_USERNAME';
   delete from public.centers where code = 'platform-bootstrap';
   commit;
   ```

   Perform this bootstrap once, review the transaction, and create all center-owner accounts from the platform console afterward. Public central signup permits members only; local SQLite mode still supports its original owner signup flow.

5. Disable email confirmation because BoxingCoach signs in with deterministic internal auth emails. Store a real contact email only in `accounts.contact_email`.
6. Build the Windows package with `-SupabaseUrl` and `-SupabasePublishableKey`, or put the same public values in `%LOCALAPPDATA%\BoxingCoach\appsettings.json`. Never place a service-role key in either location.

Production secrets and signing credentials are intentionally absent from this repository.

## SQLite migration

Export the current database without password hashes:

```powershell
python tools\export_sqlite_bundle.py `
  --database backend\boxing_coach.db `
  --output migration\boxing-coach-export.json
```

Validate the export and create mapping templates before any import:

```powershell
python tools\plan_sqlite_migration.py `
  --bundle migration\boxing-coach-export.json `
  --output migration\boxing-coach.migration-plan.json
```

See `docs/SQLITE_MIGRATION.md` for the staging-first procedure and approval gates.

The export preserves legacy IDs for deterministic mapping, but Supabase Auth uses UUIDs. Use this controlled migration order:

1. Keep the source database offline and retain an encrypted backup.
2. Run the exporter and verify the row counts printed for every table.
3. Create centers, then recreate accounts through the administrator function with temporary passwords.
4. Record a `legacy user id -> Supabase auth UUID` mapping and use it to import profiles, calibrations, sessions, and labels.
5. Require each user to change the temporary password. Never import the local PBKDF2 password hashes into `auth.users`.
6. Compare counts and sample records as each role, then keep the old SQLite database read-only until acceptance is complete.

The export file contains personal information and must be encrypted at rest, shared only with the migration operator, and deleted securely after acceptance. Run the first production migration on a staging Supabase project before migrating customer data.

## Operational checks

- Suspend a test account and confirm its next API request is rejected.
- Change a coach to member and confirm center-wide member/session access disappears immediately.
- Confirm a center owner cannot list, create, suspend, or modify accounts in another center.
- Confirm a member cannot read another member's profile, calibration, or session by guessing UUIDs.
- Confirm direct public signup cannot create a `CENTER_OWNER`; create one through the platform account console instead.
- Review `account_audit_logs` after role/status changes and `audit_logs` after center, subscription, feature, and account administration.
- Back up PostgreSQL according to the selected Supabase plan and test restore procedures before launch.

## Retired analysis data

The application no longer reads or writes calibration records or produces scores and feedback. Existing tables, RLS policies, RPC definitions, and historical migrations remain intact for data preservation. Direct database access from older clients is not revoked by this source-only change. Follow the staging/backup/approval plan in [engine removal](../docs/ENGINE_REMOVAL.md) before retiring those database interfaces or dropping any data.
