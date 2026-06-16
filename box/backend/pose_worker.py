from __future__ import annotations

import dataclasses
import importlib.util
import math
import os
import time
from typing import Any, Protocol


KEYPOINTS = [
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

COCO_INDEX = {
    "nose": 0,
    "left_shoulder": 5,
    "right_shoulder": 6,
    "left_elbow": 7,
    "right_elbow": 8,
    "left_wrist": 9,
    "right_wrist": 10,
    "left_hip": 11,
    "right_hip": 12,
    "left_knee": 13,
    "right_knee": 14,
    "left_ankle": 15,
    "right_ankle": 16,
}


@dataclasses.dataclass
class PosePacket:
    session_id: str
    camera_id: str
    view_angle: str
    timestamp: float
    pose_sequence_id: str
    keypoints: list[dict[str, Any]]
    confidence: float
    action: str
    score: int
    feedback: str
    status: str
    metrics: dict[str, int]


class PoseWorker(Protocol):
    def packet(self, session_id: str, frame_index: int) -> PosePacket:
        ...


class MMPoseUnavailable(RuntimeError):
    pass


def create_pose_worker() -> PoseWorker:
    mode = os.environ.get("POSE_WORKER", "demo").lower()
    if mode == "mmpose":
        return MMPoseCameraWorker()
    return DemoPoseWorker()


class MMPoseCameraWorker:
    """Real webcam -> MMPose -> boxing packet worker.

    Requires local dependencies:
    - opencv-python
    - torch
    - mmpose and OpenMMLab runtime packages
    """

    def __init__(self, camera_id: int | None = None, pose2d: str | None = None, device: str | None = None) -> None:
        missing = [name for name in ("cv2", "mmpose") if importlib.util.find_spec(name) is None]
        if missing:
            raise MMPoseUnavailable(f"missing dependencies: {', '.join(missing)}")

        import cv2
        from mmpose.apis import MMPoseInferencer

        self.cv2 = cv2
        self.camera_id = camera_id if camera_id is not None else int(os.environ.get("MMPPOSE_CAMERA_ID", "0"))
        self.capture = cv2.VideoCapture(self.camera_id)
        if not self.capture.isOpened():
            raise MMPoseUnavailable(f"camera {self.camera_id} is not available for MMPose")

        inferencer_kwargs: dict[str, Any] = {"pose2d": pose2d or os.environ.get("MMPOSE_POSE2D", "human")}
        if device or os.environ.get("MMPOSE_DEVICE"):
            inferencer_kwargs["device"] = device or os.environ["MMPOSE_DEVICE"]
        self.inferencer = MMPoseInferencer(**inferencer_kwargs)

    def packet(self, session_id: str, frame_index: int) -> PosePacket:
        ok, frame = self.capture.read()
        if not ok:
            raise MMPoseUnavailable("camera frame could not be read")

        height, width = frame.shape[:2]
        result = next(self.inferencer(frame, show=False, return_vis=False))
        instance = best_prediction(result)
        if instance is None:
            return packet_from_points(
                session_id=session_id,
                frame_index=frame_index,
                points=[],
                confidence=0,
                status="no_person",
            )

        keypoints = instance.get("keypoints") or []
        scores = instance.get("keypoint_scores") or instance.get("keypoints_visible") or []
        points = normalize_coco_keypoints(keypoints, scores, width, height)
        confidence = average_score(points)
        return packet_from_points(
            session_id=session_id,
            frame_index=frame_index,
            points=points,
            confidence=confidence,
            status="tracking" if confidence >= 0.45 else "low_confidence",
        )


class DemoPoseWorker:
    """Synthetic fallback used when MMPose is not installed."""

    def packet(self, session_id: str, frame_index: int) -> PosePacket:
        t = frame_index / 12
        jab_phase = (math.sin(t * 2.2) + 1) / 2
        guard_drop = (math.sin(t * 0.8) + 1) / 2
        confidence = 0.72 + 0.24 * ((math.sin(t * 1.4) + 1) / 2)
        points = self._boxing_pose(jab_phase=jab_phase, guard_drop=guard_drop)
        return packet_from_points(
            session_id=session_id,
            frame_index=frame_index,
            points=points,
            confidence=round(confidence, 3),
            status="tracking" if confidence > 0.7 else "low_confidence",
        )

    def _boxing_pose(self, jab_phase: float, guard_drop: float) -> list[dict[str, Any]]:
        base = {
            "nose": (0.50, 0.17),
            "left_shoulder": (0.42, 0.30),
            "right_shoulder": (0.58, 0.30),
            "left_elbow": (0.37, 0.45),
            "right_elbow": (0.61, 0.43),
            "left_wrist": (0.34 - jab_phase * 0.16, 0.37 + guard_drop * 0.07),
            "right_wrist": (0.57, 0.26 + guard_drop * 0.10),
            "left_hip": (0.44, 0.58),
            "right_hip": (0.56, 0.58),
            "left_knee": (0.40, 0.76),
            "right_knee": (0.61, 0.76),
            "left_ankle": (0.36, 0.93),
            "right_ankle": (0.65, 0.93),
        }
        return [
            {
                "name": name,
                "x": round(x, 4),
                "y": round(y, 4),
                "score": 0.88 if "wrist" not in name else round(0.78 + jab_phase * 0.16, 3),
            }
            for name, (x, y) in base.items()
        ]


def best_prediction(result: dict[str, Any]) -> dict[str, Any] | None:
    predictions = result.get("predictions") or []
    instances = predictions[0] if predictions and isinstance(predictions[0], list) else predictions
    if not instances:
        return None
    return max(instances, key=lambda item: sum(item.get("keypoint_scores") or [0]))


def normalize_coco_keypoints(
    keypoints: list[list[float]],
    scores: list[float],
    width: int,
    height: int,
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for name in KEYPOINTS:
        index = COCO_INDEX[name]
        if index >= len(keypoints):
            points.append({"name": name, "x": 0, "y": 0, "score": 0})
            continue
        x, y = keypoints[index][:2]
        score = scores[index] if index < len(scores) else 1
        points.append(
            {
                "name": name,
                "x": clamp(float(x) / max(width, 1)),
                "y": clamp(float(y) / max(height, 1)),
                "score": round(float(score), 3),
            }
        )
    return points


def packet_from_points(
    session_id: str,
    frame_index: int,
    points: list[dict[str, Any]],
    confidence: float,
    status: str,
) -> PosePacket:
    metrics = boxing_metrics(points)
    score = round(metrics["guard"] * 0.35 + metrics["return"] * 0.25 + metrics["rotation"] * 0.25 + metrics["balance"] * 0.15)
    action, feedback = boxing_feedback(metrics, status)
    return PosePacket(
        session_id=session_id,
        camera_id="cam_front_01",
        view_angle="front",
        timestamp=time.time(),
        pose_sequence_id=f"{session_id}:{frame_index // 24}",
        keypoints=points,
        confidence=round(confidence, 3),
        action=action,
        score=score if status != "no_person" else 0,
        feedback=feedback,
        status=status,
        metrics=metrics,
    )


def boxing_metrics(points: list[dict[str, Any]]) -> dict[str, int]:
    by_name = {point["name"]: point for point in points}
    required = ["nose", "left_wrist", "right_wrist", "left_shoulder", "right_shoulder", "left_hip", "right_hip"]
    if any(name not in by_name or by_name[name].get("score", 0) <= 0 for name in required):
        return {"guard": 0, "return": 0, "rotation": 0, "balance": 0}

    nose_y = by_name["nose"]["y"]
    shoulder_y = (by_name["left_shoulder"]["y"] + by_name["right_shoulder"]["y"]) / 2
    left_guard = score_between(by_name["left_wrist"]["y"], shoulder_y + 0.08, nose_y - 0.02)
    right_guard = score_between(by_name["right_wrist"]["y"], shoulder_y + 0.08, nose_y - 0.02)
    guard = round((left_guard + right_guard) / 2)

    shoulder_span = abs(by_name["right_shoulder"]["x"] - by_name["left_shoulder"]["x"])
    hip_span = abs(by_name["right_hip"]["x"] - by_name["left_hip"]["x"])
    rotation = clamp_score(72 + abs(shoulder_span - hip_span) * 220)

    center_x = (by_name["left_hip"]["x"] + by_name["right_hip"]["x"]) / 2
    shoulder_center_x = (by_name["left_shoulder"]["x"] + by_name["right_shoulder"]["x"]) / 2
    balance = clamp_score(100 - abs(center_x - shoulder_center_x) * 260)

    wrist_distance = abs(by_name["left_wrist"]["x"] - by_name["right_wrist"]["x"])
    hand_return = clamp_score(95 - wrist_distance * 35)
    return {"guard": guard, "return": hand_return, "rotation": rotation, "balance": balance}


def boxing_feedback(metrics: dict[str, int], status: str) -> tuple[str, str]:
    if status == "no_person":
        return "대상 미감지", "카메라 안에 전신이 들어오도록 위치를 조정하세요."
    if metrics["guard"] < 70:
        return "가드 복귀", "가드가 낮습니다. 타격 후 양손을 턱과 광대 높이로 즉시 복귀하세요."
    if metrics["return"] < 78:
        return "타격 회수", "손이 벌어져 있습니다. 잽 후 회수 속도를 더 빠르게 가져가세요."
    if metrics["balance"] < 78:
        return "중심 안정", "상체와 골반 중심이 흔들립니다. 발 간격과 무게중심을 다시 잡으세요."
    return "잽-스트레이트", "가드와 중심이 안정적입니다. 다음 라운드는 투 원 리듬으로 이어가세요."


def average_score(points: list[dict[str, Any]]) -> float:
    scores = [point.get("score", 0) for point in points]
    return sum(scores) / len(scores) if scores else 0


def score_between(value: float, bad: float, good: float) -> int:
    if good == bad:
        return 0
    ratio = (bad - value) / (bad - good)
    return clamp_score(45 + ratio * 55)


def clamp(value: float) -> float:
    return max(0, min(1, value))


def clamp_score(value: float) -> int:
    return round(max(0, min(100, value)))
