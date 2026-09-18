# Boxing AI Coach MVP

다른 기기에서 작업을 이어갈 때는 루트의 [CONTINUE_HERE.md](../CONTINUE_HERE.md)를 먼저 읽으세요. 원본 목표·진행 내역·환경 준비 명령이 저장소에 포함돼 있습니다.

Center/member management, camera previews, local workout recording, and training session records. The previous analysis engine has been removed; the UI displays “분석 엔진 준비 중”. See [engine removal and DB follow-up](docs/ENGINE_REMOVAL.md).

## Windows desktop product

The customer application now runs as a .NET 8 WPF + WebView2 Windows app with a bundled Python worker, DPAPI login storage, optional Supabase central accounts, MSIX packaging, and App Installer updates. See [Windows installation](INSTALL_WINDOWS.md), [desktop build and deployment](windows/README.md), and [Supabase setup](supabase/README.md).

## Central SaaS transition

The repository now includes a staging-ready central operations contract, platform console, PWA shell, hosted cloud API runtime, and hosted WebView mode while preserving the existing local SQLite path.

- Architecture and phased scope: [Central SaaS plan](docs/CENTRAL_SAAS_PLAN.md)
- SQLite migration: [Migration procedure](docs/SQLITE_MIGRATION.md)
- Staging and release: [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md)
- Recovery: [Rollback runbook](docs/ROLLBACK_RUNBOOK.md)

Run the hosted same-origin web/API process only with Supabase mode configured:

```powershell
$env:BOXING_COACH_DATA_MODE = "supabase"
$env:BOXING_COACH_SUPABASE_URL = "https://PROJECT.supabase.co"
$env:BOXING_COACH_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_REPLACE_ME"
python backend/cloud_server.py
```

## Run

Install backend dependencies when using a fresh Python environment:

```powershell
python -m pip install -r requirements.txt
```

If the local `.venv` exists, prefer it because it includes the app dependencies:

```powershell
.\.venv\Scripts\python.exe backend/server.py
```

```powershell
python backend/server.py
```

Open:

```text
http://127.0.0.1:8000
```

The worker binds to loopback by default. A new database has no default accounts or passwords. Create a local center administrator through signup, then use that center's code for member signup.

Existing unversioned SQLite databases are never upgraded at startup. Stop the worker and obtain explicit approval before running the offline upgrade with a new backup path:

```powershell
python tools/migrate_sqlite.py --database PATH_TO_EXISTING_DB --backup NEW_BACKUP_PATH --approve-migration
```

To preview without touching an existing database, set `BOXING_COACH_DB_PATH` to a new disposable path before starting the worker. See [backend stabilization and migration conditions](docs/refoundation/02-backend.md) and [device API contract](docs/refoundation/03-device-contract.md).

## What is implemented

- Administrator/member signup and login with signed tokens.
- Local mode administrator signup creates a new center, while member signup joins by center code. Central mode requires platform-provisioned center administrators.
- Administrators can register members and access sessions only inside their center.
- Member access only to their own profile and sessions.
- Training sessions with camera metadata ready for future multi-camera expansion.
- Coach labels for later model-training datasets.
- Camera permission requests and device selection for up to three cameras.
- Camera previews independent of session creation.
- Primary-camera recording with MediaRecorder, IndexedDB persistence, playback, download, and optional local FFmpeg conversion.
- Session start/end, elapsed time, and configured duration; no scores or generated feedback.

## Camera and session foundation

`web/scripts/session.js` owns capture, recording, and session lifecycle. `web/scripts/preferences.js` owns device settings. `backend/camera.py` accepts capture metadata only. Future analysis should consume camera sources through a separate module and must not become a prerequisite for session storage.

The camera stream stays on the device. A recording contains the primary camera video; additional cameras are previews. No models, skeleton overlays, punch events, voice feedback, or simulated results are generated.

Existing database tables and archived analysis data are preserved. Retired application endpoints return 404. Historical Supabase migrations remain unchanged; already-deployed database RPCs require a separate staging-reviewed retirement migration before their direct access is disabled.

## Tests

```powershell
python -m unittest discover -s tests
```

```powershell
node tests/test_android_offline.js
# Requires Playwright and a local Chrome installation; uses a temporary database.
node tests/test_session_browser.js
```

Set `BOXING_COACH_PYTHON` for the browser test when Python is not on PATH. `BOXING_COACH_BROWSER_CHANNEL` may select another installed Playwright browser channel. Local runtime tests set `BOXING_COACH_DB_PATH` to an isolated temporary database; they do not open the normal application database.
