# Deployment Runbook

## Environments

September 25 connected release: `release/BoxingCoach-0.3.1.0-stable/BoxingCoach.Desktop.exe`. Public signup offers center owners (new center only) and members (existing active center code). Apply both `202609250001_center_self_signup.sql` and `202609250002_retire_owner_signup_block.sql` before enabling the new UI. New centers inherit the existing 14-day trial subscription. Platform administrators remain provisioned through the guarded `admin-create-user` function; no shared password is embedded in the application. The requested `admin` account exists on the connected project; its initial credentials are kept only in ignored `artifacts/admin-initial-credentials.json` on the operator's PC and must never be distributed with the release.

Maintain separate staging and production Supabase projects, web/API deployments, release URLs, and signing credentials. Never test migrations or recovery procedures first in production.

## Staging Gate

1. Apply every migration under `supabase/migrations/` in filename order.
2. Deploy `supabase/functions/admin-create-user` with JWT verification enabled.
   Deploy `register-member` as well. For the AI feature, follow `AI_COACH_DEPLOYMENT.md` for `coach-chat`, allowed models and server-only secrets.
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

## September 24 status

The existing staging project has been reused. The ignored local staging settings are restored, the first 19 migration hashes were verified, and the additive 20th coach migration is applied. The JWT-protected `coach-chat` function is deployed with a server-only provider key and two allowed models. Real synthetic-account checks cover authentication, model configuration, usage, duplicate rejection and cross-center isolation. The Korean/English browser flow through the local central gateway and paid provider also passes; see `AI_COACH_DEPLOYMENT.md` for evidence and the approved test budget.

These checks do not constitute a hosted HTTPS release or production approval. Before promotion, still verify the selected hosted origin, backup restore, signed package and download URLs, and physical WebView2 camera behavior. No production deployment or existing SQLite migration has been performed. The historical September 22 acceptance scope in `refoundation/13-final-audit.md` does not replace the current objective; current sample-video and physical-camera evidence is tracked in `refoundation/14-sample-video-baseline.md`.

Prepare the pinned browser pose assets before packaging or hosted deployment, using `tools/prepare_motion_assets.py` and the runtime installation documented in `refoundation/07-motion-coaching.md`. A source-only checkout does not include ignored `web/vendor/motion` files. Verify manifest hashes and serve WASM with its proper MIME type. Missing pose assets must leave recording/time tracking available and display an unavailable status.
