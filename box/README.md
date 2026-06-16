# Boxing AI Coach MVP

MMPose/RTMPose style pose events, role-based gym member management, and a Jarvis-like HUD coaching screen in one local MVP.

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
- Real-time WebSocket stream that emits pose keypoints, score, target action, feedback, camera status, and boxing-specific metrics.
- Static HUD UI with sidebar, skeleton canvas, live camera panel, score, target action, and feedback overlays.

## MMPose integration point

`backend/pose_worker.py` provides two workers:

- `DemoPoseWorker`: synthetic fallback pose stream.
- `MMPoseCameraWorker`: real webcam -> OpenCV -> `MMPoseInferencer` -> boxing score/feedback packets.

Run the real MMPose worker after installing OpenMMLab dependencies and a working webcam:

```powershell
$env:POSE_WORKER="mmpose"
$env:MMPOSE_POSE2D="human"
$env:MMPOSE_DEVICE="cuda:0" # or "cpu"
python backend/server.py
```

The MMPose integration uses the official `MMPoseInferencer` style API and maps COCO human keypoints into the frontend skeleton format. If MMPose/OpenCV/camera access is unavailable, the server falls back to `DemoPoseWorker` unless `MMPoseCameraWorker` fails during an active stream.

The cloud API should continue storing keypoints, scores, events, and labels rather than raw video by default.

## Tests

```powershell
python -m unittest discover -s tests
```
