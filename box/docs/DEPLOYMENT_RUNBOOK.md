# Deployment Runbook

## Environments

Maintain separate staging and production Supabase projects, web/API deployments, release URLs, and signing credentials. Never test migrations or recovery procedures first in production.

## Staging Gate

1. Apply every migration under `supabase/migrations/` in filename order.
2. Deploy `supabase/functions/admin-create-user` with JWT verification enabled.
3. Store `SUPABASE_SERVICE_ROLE_KEY` only as an Edge Function secret.
4. Create and verify a staging `PLATFORM_ADMIN` account.
5. Run cross-center allow/deny tests for every role.
6. Suspend an account, a center, and a subscription and verify denial on the next request.
7. Verify `PLATFORM_ADMIN` cannot directly mutate member profiles, calibrations, sessions, or labels.
8. Test a backup restore before production approval.

## Central Web and API

The hosted web UI expects same-origin `/api` routes. `backend/cloud_server.py` serves the web assets and central Supabase gateway without exposing local camera/AI routes.

Required runtime settings:

```text
BOXING_COACH_DATA_MODE=supabase
BOXING_COACH_SUPABASE_URL=https://PROJECT.supabase.co
BOXING_COACH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
BOXING_COACH_AUTH_EMAIL_DOMAIN=accounts.boxingcoach.app
BOXING_COACH_HOST=127.0.0.1
BOXING_COACH_PORT=8080
```

Run it behind an approved HTTPS reverse proxy or application host. Do not expose the development HTTP listener directly to the internet.

Health checks:

```text
GET /api/system/health
GET /api/system/version
```

The cloud runtime must return `404` for local AI routes such as `/api/system/pose3d`.

## PWA Promotion

1. Deploy to a versioned staging release.
2. Verify manifest and service-worker scope over HTTPS.
3. Confirm installation on desktop and mobile.
4. Start an exercise session, deploy a new web version, and confirm activation waits until the session ends.
5. Enable `web.beta` only for selected staging centers.
6. Promote the same verified artifact to stable.

Keep at least one previously verified web artifact available for immediate rollback.

## Windows Hosted Package

Example release build:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\build-release.ps1 `
  -Version 0.3.0 `
  -Channel beta `
  -UiMode hosted `
  -HostedAppUrl https://staging-app.example.com/ `
  -SupabaseUrl https://PROJECT.supabase.co `
  -SupabasePublishableKey sb_publishable_REPLACE_ME `
  -PackageBaseUri https://downloads.example.com/boxingcoach
```

Production packages require an approved code-signing certificate. The client receives only the publishable Supabase key.

Verify:

- Only the configured HTTPS application origin loads.
- Camera permission is denied to every other origin.
- `/__local_api` accepts only the approved AI/calibration/recording routes.
- The worker rejects protected requests without the per-launch bridge secret.
- Web/bridge/engine incompatibility shows an update requirement.
- Hosted navigation failure uses the bundled fallback when enabled.

## Android Modes

Without a hosted URL, Android preserves its bundled offline mode. To build central hosted mode, supply the HTTPS application URL as a Gradle property:

```powershell
gradle -p android -PBOXING_COACH_HOSTED_APP_URL=https://app.example.com assembleRelease
```

Hosted mode disables the offline API adapter and blocks navigation outside the configured origin.

## Production Approval Checklist

- Database backup and tested restore point exist.
- Migration plan is valid and mappings are complete.
- Staging role and tenant tests pass.
- Web rollback artifact is available.
- Windows stable and beta channels use distinct package identities.
- Signing and release URLs are correct.
- No service-role key, password, token, personal export, or certificate secret appears in client artifacts or logs.
- An authorized operator explicitly approves production deployment and data migration.
