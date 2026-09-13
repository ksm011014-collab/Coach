# Boxing AI Coach MVP

MediaPipe-based real-time pose coaching, role-based center member management, and a Jarvis-like HUD coaching screen in one local MVP.

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

Check OpenCV/NumPy before multi-camera sample validation:

```powershell
.\.venv\Scripts\python.exe -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
```

```powershell
python backend/server.py
```

Open:

```text
http://127.0.0.1:8000
```

To open the app on a TV, tablet, or other device on the same Wi-Fi, start the server in LAN mode and open `http://192.168.45.212:8000` on that device:

```powershell
$env:BOXING_COACH_HOST = "0.0.0.0"
.\.venv\Scripts\python.exe backend/server.py
```

Seed accounts:

```text
owner / Owner!123
member / Member!123
```

Default center code:

```text
apex
```

## What is implemented

- Administrator/member signup and login with signed tokens.
- Local mode administrator signup creates a new center, while member signup joins by center code. Central mode requires platform-provisioned center administrators.
- Administrators can register members and access sessions only inside their center.
- Member access only to their own profile and sessions.
- Training sessions with camera metadata ready for future multi-camera expansion.
- Coach labels for later model-training datasets.
- Browser-side MediaPipe pose detection that emits keypoints, score, target action, feedback, camera status, and boxing-specific metrics.
- Camera rig settings for 1/2/3 camera modes, including human-pose calibration in Settings.
- Optional backend 3D pose endpoint that accepts multi-camera keypoint observations and uses OpenCV triangulation when calibrated projection matrices are available.
- Static HUD UI with sidebar, skeleton canvas, live camera panel, score, target action, and feedback overlays.

## MediaPipe pose detection

Real-time coaching uses MediaPipe Pose Landmarker directly in the browser. The backend only serves the app and stores member/session data, so the webcam stream does not pass through Python.

- The browser loads `@mediapipe/tasks-vision` from CDN.
- The app uses the lightweight Pose Landmarker model with GPU delegation when available.
- Camera video, skeleton drawing, feedback, score, and recording are all handled in the HUD without a pose backend.

The cloud API should continue storing keypoints, scores, events, and labels rather than raw video by default.

## Multi-camera 3D pose

The app now stores session camera configuration for one, two, or three cameras. Settings includes a Camera Rig panel where an operator can choose the camera count, assign detected browser camera devices, and run human-pose calibration.

- 1 camera runs the current browser MediaPipe 2D skeleton path.
- 2 cameras enable the minimum 3D rig mode after calibration.
- 3 cameras use the same path with an extra view for occlusion recovery and better confidence.

Human calibration captures synchronized MediaPipe keypoints while the athlete stands centered, holds an A-pose, and rotates slowly. The backend endpoint `POST /api/calibration/human` estimates relative camera geometry with OpenCV and returns calibrated camera entries with `projection_matrix` values. The app saves those values locally in the camera rig settings.

Each member must complete calibration before their first coaching session. The user enters height only; the calibration samples estimate body scale, arm length, and shoulder width, then automatically save `reach_cm` back to the member profile. Reach is displayed as an auto-calculated value rather than a manual signup/profile field.

The backend also exposes `POST /api/pose/3d` for multi-camera packets. It expects `camera_config` and synchronized 2D keypoint `observations`; if at least two calibrated cameras include `projection_matrix` values and `opencv-python` is installed, it returns `keypoints_3d`. Without calibration or OpenCV, the endpoint returns a clear status such as `calibration_required` or `opencv_unavailable` instead of failing the live 2D HUD.

3D readiness and calibration persistence endpoints:

- `GET /api/system/pose3d` returns Python/OpenCV availability for the active server process.
- `GET /api/members/{profile_id}/calibration` returns the saved calibration for an accessible member.
- `POST /api/members/{profile_id}/calibration` stores a ready calibration and updates auto-estimated reach.

## Tests

```powershell
python -m unittest discover -s tests
```
