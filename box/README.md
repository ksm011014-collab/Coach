# Boxing AI Coach MVP

MediaPipe-based real-time pose coaching, role-based gym member management, and a Jarvis-like HUD coaching screen in one local MVP.

## Run

```powershell
python backend/server.py
```

Open:

```text
http://127.0.0.1:8000
```

Seed accounts:

```text
owner / Owner!123
member / Member!123
```

## What is implemented

- Owner/member signup and login with signed tokens.
- Owner access to all members and sessions in their gym.
- Member access only to their own profile and sessions.
- Training sessions with camera metadata ready for future multi-camera expansion.
- Coach labels for later model-training datasets.
- Browser-side MediaPipe pose detection that emits keypoints, score, target action, feedback, camera status, and boxing-specific metrics.
- Static HUD UI with sidebar, skeleton canvas, live camera panel, score, target action, and feedback overlays.

## MediaPipe pose detection

Real-time coaching uses MediaPipe Pose Landmarker directly in the browser. The backend only serves the app and stores member/session data, so the webcam stream does not pass through Python.

- The browser loads `@mediapipe/tasks-vision` from CDN.
- The app uses the lightweight Pose Landmarker model with GPU delegation when available.
- Camera video, skeleton drawing, feedback, score, and recording are all handled in the HUD without a pose backend.

The cloud API should continue storing keypoints, scores, events, and labels rather than raw video by default.

## Tests

```powershell
python -m unittest discover -s tests
```
