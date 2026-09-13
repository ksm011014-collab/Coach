# BoxingCoach Central SaaS Transition Plan

## Baseline

Validated on 2026-08-09 before transition work:

- Python: `python -m unittest discover -s tests -v` passed 29 tests.
- JavaScript: `test_motion_classifier.js` and `test_android_offline.js` passed.
- Windows: `BoxingCoach.Desktop.SmokeTests` passed with a repository-local .NET CLI home.
- Local development data is stored in `backend/boxing_coach.db`.
- Existing packaged Windows layouts use `DataMode=local` and contain no Supabase credentials.

The worktree already contained broad uncommitted application changes and generated artifacts. They are treated as user-owned and must be preserved.

## Current State

### Implemented

- Local Python API with SQLite tenant scoping.
- Optional Supabase gateway for identity, accounts, centers, member profiles, calibrations, session summaries, and coach labels.
- Supabase RLS for the existing central tables.
- Guarded account, profile, and calibration RPCs.
- Basic platform/center account-management UI.
- WPF/WebView2 desktop shell that launches a bundled Python worker and displays the local web UI.
- DPAPI-backed desktop login session bridge.
- MSIX/App Installer stable and beta packaging.
- Android WebView package with bundled web assets and an offline data adapter.
- SQLite export that excludes password hashes.

### Missing

- Center lifecycle and contract controls: active state, suspension, contract period, plan, and enforcement.
- Center creation and update operations restricted to `PLATFORM_ADMIN`.
- Per-center feature flags and staged web rollout metadata.
- General administrative audit events for center, subscription, and feature changes.
- Central operations API and UI for centers, usage, subscriptions, feature flags, and audit history.
- PWA manifest, icons, service worker, safe update activation, and deployment version metadata.
- A hosted API path for browser/PWA clients. The current hosted static UI would still call relative `/api` routes that only exist in the local Python process.
- Hosted WebView mode, HTTPS origin allowlist, source-bound native messages, bridge protocol versioning, and safe offline fallback.
- Engine/web compatibility negotiation.
- SQLite import planning/validation tooling beyond the current password-safe export.
- Staging, promotion, rollback, backup, and recovery runbooks.

## Security Gaps

- Existing RLS permits `PLATFORM_ADMIN` to mutate member profiles, calibrations, sessions, and labels. The product requirement is read/operations visibility without unrestricted training-record mutation.
- Center suspension cannot currently invalidate tenant activity because centers have no lifecycle status.
- The account audit table covers only account access changes and requires an account target, so it cannot represent center or subscription changes cleanly.
- The desktop native bridge parses message types but does not bind accepted messages to an explicitly configured hosted source.
- The current WebView navigation policy accepts only the local worker origin and has no hosted-mode configuration or fallback policy.
- Public center-owner signup can create a center without a platform approval workflow. Central mode therefore blocks this path at both the gateway and database trigger; local SQLite mode retains the original flow.

## Target Boundaries

### Central Data Plane

Supabase owns:

- Authentication and account status.
- Centers and center lifecycle.
- Membership and tenant relationships.
- Member profiles and calibration summaries.
- Training session summaries and coach labels.
- Subscription/contract state.
- Feature flags and rollout channel.
- Administrative audit records.

### Local Device Plane

The Windows device owns:

- Camera capture and permissions.
- MediaPipe/OpenCV processing.
- Multi-camera calibration computation.
- Local recordings and temporary processing files.
- The restricted bridge between the hosted UI and the local engine.

Raw video stays local by default. Only explicitly selected summaries and derived records are synchronized centrally.

### Hosted Web Plane

The hosted application provides:

- Role-based center/member workflows.
- Member training-history access.
- Platform operations console.
- PWA installation.
- Versioned static assets and staged rollout.

Browser/PWA clients require a hosted central API or a dedicated direct-Supabase client adapter. Local-only AI routes must never be assumed to exist in a normal browser.

## Delivery Phases

### Phase 1: Central Contract

Expected files:

- New ordered migrations under `supabase/migrations/`.
- `backend/central_gateway.py`.
- `tests/test_central_gateway.py` and new migration contract tests.
- `supabase/README.md`.

Deliverables:

- Center lifecycle, subscriptions, feature flags, usage summary, and general audit schema.
- Guarded platform RPCs.
- RLS that removes platform training-record mutation while retaining required visibility.
- Center suspension enforcement on the next request.

### Phase 2: Operations Console and PWA

Expected files:

- `web/index.html`, `web/app.js`, `web/styles.css`.
- New scripts under `web/scripts/`.
- PWA manifest, service worker, and icon assets under `web/`.
- Central gateway routes and tests.

Deliverables:

- Center list, search, detail, lifecycle, subscription, feature flags, usage, and audit views.
- Role-gated platform navigation and APIs.
- Installable PWA with controlled update activation.

### Phase 3: Hosted Desktop Mode

Expected files:

- `windows/BoxingCoach.Desktop/Services/AppConfiguration.cs`.
- `windows/BoxingCoach.Desktop/MainWindow.xaml.cs`.
- `windows/BoxingCoach.Desktop/Services/NativeBridge.cs`.
- New desktop policy/version classes and smoke tests.
- `windows/appsettings.example.json` and packaging scripts.

Deliverables:

- Local and hosted UI modes.
- Exact HTTPS origin allowlist.
- Source-bound and schema-validated native messages.
- Web/engine protocol compatibility checks.
- Safe bundled fallback when hosted UI cannot be used.

### Phase 4: Migration and Operations

Expected files:

- `tools/export_sqlite_bundle.py` and validation/import planning utilities.
- `docs/SQLITE_MIGRATION.md`.
- `docs/DEPLOYMENT_RUNBOOK.md`.
- `docs/ROLLBACK_RUNBOOK.md`.
- Android review notes and changes where safe.

Deliverables:

- Deterministic legacy-ID mapping and count validation.
- Staging-first migration procedure.
- Backup, restore, promotion, and rollback instructions.
- Clear credential and production-approval boundaries.

## Required Verification

- A center A actor cannot read or mutate center B tenant data.
- A member cannot read another member's profile, calibration, or sessions.
- A center owner cannot administer another center.
- Downgrading a coach to member removes center-wide access on the next request.
- Suspended accounts and suspended/expired centers are denied on the next request.
- Only `PLATFORM_ADMIN` can use platform operations RPCs and UI.
- `PLATFORM_ADMIN` cannot directly mutate member training records by default.
- Client flows work without a service-role key.
- An unapproved web origin cannot invoke the native bridge or local worker.
- The approved hosted origin can use camera/local processing through the bridge.
- Network failure and incompatible web/engine versions produce a safe state.
- Export/import validation proves record counts and center ownership mappings.

## External Dependencies

The repository can be completed with placeholders and local tests, but these actions require explicit user-owned credentials or approval:

- Creating staging and production Supabase projects.
- Applying migrations to a remote project.
- Deploying Edge Functions or hosted web/API services.
- Supplying release URLs, signing certificates, or production secrets.
- Migrating or modifying real production data.
- Publishing MSIX, Android, PWA, or server releases.
