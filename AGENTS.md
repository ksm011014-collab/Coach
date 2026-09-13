# BoxingCoach Repository Instructions

## Scope

- This file applies to the entire repository rooted at this directory.
- The main application lives in `box/`.
- Preserve user changes and keep edits focused on the requested task.
- If a deeper directory contains another `AGENTS.md`, follow the deeper file for that subtree.

## Product Direction

- BoxingCoach is a multi-tenant fitness management and AI coaching product.
- The target architecture is a centrally hosted web service with local device capabilities.
- Use the hosted web application for accounts, centers, members, permissions, subscriptions, feature flags, and training records.
- Keep camera capture, MediaPipe/OpenCV processing, calibration, and hardware-dependent work on the customer device when practical.
- Keep the Windows WPF/WebView2 shell and local Python worker unless the task explicitly replaces them.
- General web UI changes should not require reinstalling the Windows application.
- Require a desktop application update only when the native shell, local bridge, or local AI engine changes.

## Repository Layout

- `box/web/`: shared HTML, CSS, and JavaScript user interface.
- `box/backend/`: Python local server, SQLite implementation, local APIs, and pose processing.
- `box/windows/`: .NET 8 WPF/WebView2 desktop shell and Windows packaging.
- `box/android/`: Android WebView application.
- `box/supabase/`: PostgreSQL migrations, RLS policies, RPCs, and Edge Functions.
- `box/tests/`: Python and JavaScript tests.
- `box/tools/`: migration and maintenance utilities.
- `box/artifacts/`, `box/build/`, and `box/release/`: generated or packaged outputs; do not edit them as source files.

## Data Modes

- Local development defaults to SQLite at `box/backend/boxing_coach.db`.
- An installed frozen Windows worker stores local SQLite data under `%LOCALAPPDATA%\BoxingCoach\boxing_coach.db`.
- Central mode uses Supabase and is selected with `BOXING_COACH_DATA_MODE=supabase` plus the public Supabase URL and publishable key.
- Keep local mode operational until central-mode migration has been verified.
- Never delete, overwrite, or migrate an existing SQLite database without an explicit backup and user approval.
- Test production migrations against a staging Supabase project first.

## Multi-Tenant Authorization

- Supported roles are `PLATFORM_ADMIN`, `CENTER_OWNER`, `COACH`, and `MEMBER`.
- Enforce tenant isolation in the database with Supabase RLS, not only in the UI or API handler.
- Every tenant-owned row must be associated with a center identifier.
- Prefer `center_id` for central PostgreSQL schema consistency; preserve compatibility where legacy code exposes `gym_id`.
- `PLATFORM_ADMIN` manages centers and accounts but should not gain unrestricted mutation of member training records by default.
- `CENTER_OWNER` and `COACH` may access only their own center according to their role.
- `MEMBER` may access only their own profile, calibration, and training records.
- Add authorization tests whenever an RLS policy, role rule, account state, or tenant-owned table changes.

## Security

- Never place a Supabase `service_role` key in web, Windows, Android, examples, logs, or committed configuration.
- Use only publishable client keys in client applications.
- Keep privileged operations in guarded PostgreSQL RPCs or server-side/Edge Function code.
- Do not commit actual service URLs, secrets, certificate passwords, access tokens, personal data, or production exports.
- Update `.env.example` and `windows/appsettings.example.json` with placeholders when adding configuration.
- Restrict the Windows local bridge to approved origins and validated message schemas.
- Do not expose the local Python worker to the LAN or internet by default.
- Do not log passwords, tokens, raw personal data, or signing secrets.
- Record privileged operational changes in an audit log when central administration is involved.

## Editing Guidelines

- Inspect the relevant implementation and tests before editing.
- Fix root causes and avoid unrelated refactors.
- Preserve the existing vanilla web architecture unless a requested task explicitly introduces a framework.
- Keep Python, JavaScript, C#, SQL, PowerShell, and Java changes consistent with adjacent code.
- Do not hand-edit generated packages or compiled assets when the source or build script can be changed instead.
- Do not commit, push, publish packages, deploy infrastructure, or modify production data unless explicitly requested.
- Use repository-relative paths in documentation and avoid machine-specific paths except in clearly marked examples.

## Database Changes

- Add new Supabase changes as ordered migration files under `box/supabase/migrations/`.
- Do not rewrite an already-applied migration to change production behavior; add a new migration.
- Make migrations safe to review and rerun where practical.
- Include indexes, constraints, RLS enablement, policies, grants, and revokes required by the feature.
- Treat client-side visibility checks as usability only; database authorization remains authoritative.
- Preserve legacy identifiers during controlled SQLite-to-Supabase migration and document ID mappings.

## Desktop and Web Integration

- Development mode may continue loading the bundled/local web UI.
- Hosted mode should load only an approved HTTPS application origin.
- Camera permission must be granted only to the approved application origin.
- Remote web code must communicate with native/local capabilities through a restricted bridge.
- Define and check compatibility between the hosted web version and local engine API version.
- Provide a safe failure state for network loss or incompatible versions.
- Preserve MSIX/App Installer packaging and update behavior unless the task explicitly changes distribution.

## Validation

Run the narrowest relevant tests first, then broaden validation when appropriate.

From `box/`:

```powershell
python -m unittest discover -s tests
```

For JavaScript tests, run the relevant test file with Node when the test is standalone, for example:

```powershell
node tests/test_motion_classifier.js
node tests/test_android_offline.js
```

For Windows changes, build or test the affected project when the required .NET SDK and packages are available:

```powershell
dotnet test windows/BoxingCoach.Desktop.SmokeTests/BoxingCoach.Desktop.SmokeTests.csproj
dotnet build windows/BoxingCoach.Desktop/BoxingCoach.Desktop.csproj
```

- Do not fix unrelated test failures as part of a focused task.
- Report commands that were not run and why.
- For authorization work, verify both allowed and denied cross-center access.
- For migration work, compare record counts and representative records before declaring success.

## Delivery

- Summarize the outcome, important files changed, and validation performed.
- Call out security, migration, deployment, and backward-compatibility implications.
- Clearly separate completed implementation from steps requiring user-owned credentials or production approval.
