# Rollback Runbook

## Immediate Containment

1. Stop the rollout channel or disable the affected feature flag.
2. Do not delete logs, mappings, source databases, or failed artifacts.
3. Record the affected release, centers, time window, and observed symptoms.
4. If tenant isolation may be affected, disable writes and suspend the affected application path until verified.

## Web Rollback

1. Repoint the stable deployment to the last verified immutable web artifact.
2. Keep `/api/system/version` aligned with that artifact.
3. Verify login, center isolation, member history, and an active training session.
4. Allow the service worker to offer the rollback artifact without forcing a reload during an active session.

Do not edit the failed artifact in place; publish or select a known version.

## Feature and Contract Rollback

- Restore the previous feature-flag value through the guarded platform API.
- Restore center or subscription state only after verifying the prior audit-log value.
- Confirm the new audit event records the rollback.
- Never modify or delete an existing audit record.

## Windows Rollback

App Installer does not provide a safe arbitrary downgrade path. Rebuild the last verified code as a new, higher package version and publish it through the same channel. Do not reuse an existing version number.

For a hosted-web-only defect, roll back the web artifact without replacing the Windows package.

## Database Rollback

Supabase migrations are forward-only by default. Prefer a reviewed corrective migration. Restore a database backup only when the approved incident plan accepts losing every write after the restore point.

Before any restore:

1. Stop application writes.
2. Preserve a snapshot of the failed state for analysis.
3. Confirm the restore point and expected data-loss window.
4. Obtain explicit production approval.
5. Restore to an isolated environment and verify it before replacing production.

## SQLite Migration Rollback

If import verification fails before customer cutover:

1. Keep the original SQLite database as the system of record.
2. Disable access to the incomplete Supabase environment.
3. Preserve the export, migration plan, completed mappings, and failure logs securely.
4. Correct the import process in staging and repeat from a clean staging database.

If verification fails after cutover, stop writes and follow the approved database incident plan. Do not merge divergent SQLite and Supabase histories manually.

## Exit Criteria

- The selected release is identifiable and immutable.
- Role and cross-center denial tests pass.
- Local camera/AI routes remain inaccessible from unapproved origins.
- Record counts and tenant assignments are verified.
- Audit history records containment and recovery actions.
- The incident owner approves reopening normal traffic.
