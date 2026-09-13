from __future__ import annotations

import itertools
import statistics
import time
from collections import defaultdict
from typing import Any


KEYPOINT_NAMES = [
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

BODY_SCALE_SCORE_THRESHOLD = 0.45
CALIBRATION_POINT_SCORE_THRESHOLD = 0.35
TRIANGULATION_POINT_SCORE_THRESHOLD = 0.2

DEFAULT_CAMERA_RIG = [
    {"camera_id": "cam_front_01", "view_angle": "front", "role": "primary", "enabled": True},
    {"camera_id": "cam_side_01", "view_angle": "side_90", "role": "depth", "enabled": True},
    {"camera_id": "cam_rear_45_01", "view_angle": "rear_45", "role": "occlusion_guard", "enabled": False},
]


def normalize_camera_config(raw_config: Any) -> list[dict[str, Any]]:
    if isinstance(raw_config, dict):
        raw_cameras = raw_config.get("cameras") or []
    elif isinstance(raw_config, list):
        raw_cameras = raw_config
    else:
        raw_cameras = []

    if not raw_cameras:
        raw_cameras = [DEFAULT_CAMERA_RIG[0]]

    cameras: list[dict[str, Any]] = []
    for index, raw_camera in enumerate(raw_cameras[:3]):
        template = DEFAULT_CAMERA_RIG[min(index, len(DEFAULT_CAMERA_RIG) - 1)]
        camera = dict(template)
        if isinstance(raw_camera, dict):
            camera.update(raw_camera)
        camera["camera_id"] = str(camera.get("camera_id") or template["camera_id"])
        camera["view_angle"] = str(camera.get("view_angle") or template["view_angle"])
        camera["role"] = str(camera.get("role") or template["role"])
        camera["enabled"] = bool(camera.get("enabled", True))
        camera["device_id"] = str(camera.get("device_id") or "")
        camera["calibrated"] = bool(camera.get("calibrated", False))
        camera["calibration_status"] = "ready" if camera_ready_for_3d(camera) else "missing"
        cameras.append(camera)
    return cameras


def enabled_cameras(camera_config: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [camera for camera in camera_config if camera.get("enabled")]


def opencv_status() -> dict[str, Any]:
    try:
        import cv2  # type: ignore

        return {"available": True, "version": getattr(cv2, "__version__", "unknown")}
    except Exception:
        return {"available": False, "version": ""}


def calibration_summary(camera_config: list[dict[str, Any]]) -> dict[str, Any]:
    cameras = enabled_cameras(camera_config)
    calibrated = [camera for camera in cameras if camera_ready_for_3d(camera)]
    camera_count = len(cameras)
    missing = [camera["camera_id"] for camera in cameras if not camera_ready_for_3d(camera)]
    if camera_count < 2:
        mode = "2d"
        ready = True
        status = "single_camera_2d"
    elif len(calibrated) >= 2:
        mode = "3d"
        ready = True
        status = "calibrated"
    else:
        mode = "3d_pending"
        ready = False
        status = "calibration_required"
    return {
        "mode": mode,
        "status": status,
        "ready": ready,
        "camera_count": camera_count,
        "required_cameras": 2 if camera_count >= 2 else 1,
        "missing_calibration": missing,
        "opencv": opencv_status(),
    }


def build_pose3d_packet(body: dict[str, Any]) -> dict[str, Any]:
    camera_config = normalize_camera_config(body.get("camera_config"))
    summary = calibration_summary(camera_config)
    observations = body.get("observations") if isinstance(body.get("observations"), list) else []
    session_id = str(body.get("session_id") or "")

    if summary["mode"] == "2d":
        return pose3d_status_packet(session_id, "single_camera_2d", summary, [])
    if not summary["ready"]:
        return pose3d_status_packet(session_id, "calibration_required", summary, [])
    if len(observations) < 2:
        return pose3d_status_packet(session_id, "insufficient_observations", summary, [])
    if not summary["opencv"]["available"]:
        return pose3d_status_packet(session_id, "opencv_unavailable", summary, [])

    try:
        keypoints = triangulate_keypoints(observations, camera_config)
    except ValueError as exc:
        return pose3d_status_packet(session_id, str(exc), summary, [])

    status = "tracking" if keypoints else "insufficient_points"
    return pose3d_status_packet(session_id, status, summary, keypoints)


def build_human_calibration(body: dict[str, Any]) -> dict[str, Any]:
    camera_config = normalize_camera_config(body.get("camera_config"))
    cameras = enabled_cameras(camera_config)
    samples = body.get("samples") if isinstance(body.get("samples"), list) else []
    minimum_samples = int(body.get("minimum_samples") or 12)
    body_scale = estimate_body_scale(samples, cameras[0]["camera_id"] if cameras else "", body.get("body_profile") or {})

    if len(cameras) < 2:
        calibrated = [calibrated_primary_camera(camera) for camera in cameras]
        return human_calibration_packet("single_camera_2d", True, calibrated, len(samples), [], body_scale)
    usable_samples = [sample for sample in samples if len(sample.get("observations") or []) >= 2]
    if len(usable_samples) < minimum_samples:
        return human_calibration_packet(
            "insufficient_samples",
            False,
            camera_config,
            len(usable_samples),
            [f"capture at least {minimum_samples} multi-camera pose samples"],
            body_scale,
        )
    if not opencv_status()["available"]:
        return human_calibration_packet("opencv_unavailable", False, camera_config, len(usable_samples), [], body_scale)

    cv2, np = load_opencv()
    primary = cameras[0]
    calibrated_by_id = {primary["camera_id"]: calibrated_primary_camera(primary)}
    errors = []

    for camera in cameras[1:]:
        primary_points, camera_points = paired_calibration_points(usable_samples, primary["camera_id"], camera["camera_id"])
        if len(primary_points) < 24:
            errors.append(f"{camera['camera_id']}: insufficient_points")
            continue
        try:
            projection, quality = estimate_relative_projection(cv2, np, primary_points, camera_points)
        except ValueError as exc:
            errors.append(f"{camera['camera_id']}: {exc}")
            continue
        calibrated = dict(camera)
        calibrated["calibrated"] = True
        calibrated["calibration_status"] = "ready"
        calibrated["calibrated_at"] = time.time()
        calibrated["projection_matrix"] = projection
        calibrated["calibration"] = {
            "method": "human_pose",
            "reference_camera_id": primary["camera_id"],
            "matched_points": len(primary_points),
            "sample_count": len(usable_samples),
            **quality,
        }
        calibrated_by_id[camera["camera_id"]] = calibrated

    calibrated_count = len(calibrated_by_id)
    status = "calibrated" if calibrated_count == len(cameras) else "partial_calibration"
    ready = calibrated_count >= 2
    output_cameras = []
    for camera in camera_config:
        output_cameras.append(calibrated_by_id.get(camera["camera_id"], camera))
    if not ready and not errors:
        errors.append("not enough cameras solved")
    return human_calibration_packet(status if ready else "calibration_failed", ready, output_cameras, len(usable_samples), errors, body_scale)


def human_calibration_packet(
    status: str,
    ready: bool,
    cameras: list[dict[str, Any]],
    sample_count: int,
    errors: list[str],
    body_scale: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "ready": ready,
        "sample_count": sample_count,
        "camera_count": len(enabled_cameras(cameras)),
        "cameras": cameras,
        "body_scale": body_scale or {},
        "errors": errors,
        "opencv": opencv_status(),
    }


def estimate_body_scale(samples: list[dict[str, Any]], primary_camera_id: str, body_profile: dict[str, Any]) -> dict[str, Any]:
    height_cm = float(body_profile.get("height_cm") or 0)
    if height_cm <= 0 or not primary_camera_id:
        return {}
    measurements = []
    for sample in samples:
        observations = {str(item.get("camera_id") or ""): item for item in sample.get("observations") or []}
        primary = observations.get(primary_camera_id)
        if not primary:
            continue
        points = keypoints_by_name(primary)
        measurement = body_measurement_from_points(points)
        if measurement:
            measurements.append(measurement)
    if not measurements:
        return {}
    body_height_units = median_value([item["body_height"] for item in measurements])
    if body_height_units <= 0:
        return {}
    cm_per_unit = height_cm / body_height_units
    shoulder_width = median_value([item["shoulder_width"] for item in measurements]) * cm_per_unit
    left_arm = median_value([item["left_arm"] for item in measurements]) * cm_per_unit
    right_arm = median_value([item["right_arm"] for item in measurements]) * cm_per_unit
    hand_allowance = max(8.0, min(11.0, height_cm * 0.055))
    reach_cm = shoulder_width + left_arm + right_arm + hand_allowance * 2
    return {
        "height_cm": round(height_cm, 1),
        "estimated_reach_cm": int(round(reach_cm)),
        "cm_per_unit": round(cm_per_unit, 5),
        "scale_source": "human_height",
        "sample_count": len(measurements),
        "body_segments_cm": {
            "shoulder_width": int(round(shoulder_width)),
            "left_arm": int(round(left_arm + hand_allowance)),
            "right_arm": int(round(right_arm + hand_allowance)),
            "hand_allowance_each": round(hand_allowance, 1),
        },
    }


def body_measurement_from_points(points: dict[str, dict[str, Any]]) -> dict[str, float] | None:
    if any(point_score(points.get(name)) < BODY_SCALE_SCORE_THRESHOLD for name in KEYPOINT_NAMES):
        return None
    y_values = [float(points[name].get("y") or 0) for name in KEYPOINT_NAMES]
    body_height = max(y_values) - min(y_values)
    shoulder_width = distance_2d(points["left_shoulder"], points["right_shoulder"])
    left_arm = distance_2d(points["left_shoulder"], points["left_elbow"]) + distance_2d(points["left_elbow"], points["left_wrist"])
    right_arm = distance_2d(points["right_shoulder"], points["right_elbow"]) + distance_2d(points["right_elbow"], points["right_wrist"])
    if body_height <= 0 or shoulder_width <= 0 or left_arm <= 0 or right_arm <= 0:
        return None
    return {
        "body_height": body_height,
        "shoulder_width": shoulder_width,
        "left_arm": left_arm,
        "right_arm": right_arm,
    }


def point_score(point: dict[str, Any] | None) -> float:
    return float(point.get("score") or 0) if point else 0


def distance_2d(first: dict[str, Any], second: dict[str, Any]) -> float:
    dx = float(first.get("x") or 0) - float(second.get("x") or 0)
    dy = float(first.get("y") or 0) - float(second.get("y") or 0)
    return (dx * dx + dy * dy) ** 0.5


def median_value(values: list[float]) -> float:
    positive_values = [value for value in values if value > 0]
    return float(statistics.median(positive_values)) if positive_values else 0.0


def calibrated_primary_camera(camera: dict[str, Any]) -> dict[str, Any]:
    calibrated = dict(camera)
    calibrated["calibrated"] = True
    calibrated["calibration_status"] = "ready"
    calibrated["calibrated_at"] = time.time()
    calibrated["projection_matrix"] = normalized_primary_projection()
    calibrated["calibration"] = {
        "method": "human_pose",
        "reference_camera_id": camera["camera_id"],
        "matched_points": 0,
        "sample_count": 0,
        "inlier_ratio": 1,
    }
    return calibrated


def normalized_primary_projection() -> list[list[float]]:
    return [
        [1.0, 0.0, 0.5, 0.0],
        [0.0, 1.0, 0.5, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ]


def paired_calibration_points(
    samples: list[dict[str, Any]],
    primary_camera_id: str,
    camera_id: str,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    primary_points: list[tuple[float, float]] = []
    camera_points: list[tuple[float, float]] = []
    for sample in samples:
        observations = {str(item.get("camera_id") or ""): item for item in sample.get("observations") or []}
        primary = observations.get(primary_camera_id)
        camera = observations.get(camera_id)
        if not primary or not camera:
            continue
        primary_by_name = keypoints_by_name(primary)
        camera_by_name = keypoints_by_name(camera)
        for name in KEYPOINT_NAMES:
            first = primary_by_name.get(name)
            second = camera_by_name.get(name)
            if not first or not second:
                continue
            if (
                float(first.get("score") or 0) < CALIBRATION_POINT_SCORE_THRESHOLD
                or float(second.get("score") or 0) < CALIBRATION_POINT_SCORE_THRESHOLD
            ):
                continue
            primary_points.append((float(first.get("x") or 0), float(first.get("y") or 0)))
            camera_points.append((float(second.get("x") or 0), float(second.get("y") or 0)))
    return primary_points, camera_points


def keypoints_by_name(observation: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(point.get("name") or ""): point
        for point in observation.get("keypoints") or []
        if str(point.get("name") or "") in KEYPOINT_NAMES
    }


def estimate_relative_projection(
    cv2: Any,
    np: Any,
    primary_points: list[tuple[float, float]],
    camera_points: list[tuple[float, float]],
) -> tuple[list[list[float]], dict[str, Any]]:
    first = np.array(primary_points, dtype=np.float64)
    second = np.array(camera_points, dtype=np.float64)
    camera_matrix = np.array([[1.0, 0.0, 0.5], [0.0, 1.0, 0.5], [0.0, 0.0, 1.0]], dtype=np.float64)
    essential, mask = cv2.findEssentialMat(
        first,
        second,
        cameraMatrix=camera_matrix,
        method=cv2.RANSAC,
        prob=0.999,
        threshold=0.015,
    )
    if essential is None:
        raise ValueError("essential_matrix_failed")
    if essential.shape[0] > 3:
        essential = essential[:3, :]
    recovered, rotation, translation, pose_mask = cv2.recoverPose(essential, first, second, cameraMatrix=camera_matrix)
    if recovered < 8:
        raise ValueError("pose_recovery_failed")
    projection = camera_matrix @ np.hstack([rotation, translation])
    inliers = int(np.count_nonzero(mask)) if mask is not None else int(recovered)
    inlier_ratio = inliers / max(1, len(primary_points))
    return matrix_to_list(projection), {
        "inlier_ratio": round(float(inlier_ratio), 3),
        "recovered_points": int(recovered),
        "rotation": matrix_to_list(rotation),
        "translation": [round(float(value), 6) for value in translation.reshape(-1).tolist()],
    }


def matrix_to_list(matrix: Any) -> list[list[float]]:
    return [[round(float(value), 8) for value in row] for row in matrix.tolist()]


def pose3d_status_packet(
    session_id: str,
    status: str,
    calibration: dict[str, Any],
    keypoints: list[dict[str, Any]],
) -> dict[str, Any]:
    confidence = sum(point.get("score", 0) for point in keypoints) / max(1, len(keypoints))
    return {
        "session_id": session_id,
        "camera_id": "multi_camera_rig",
        "view_angle": "world_3d",
        "pose_space": "world_3d",
        "timestamp": time.time(),
        "status": status,
        "confidence": round(confidence, 3),
        "keypoints_3d": keypoints,
        "calibration": calibration,
    }


def triangulate_keypoints(
    observations: list[dict[str, Any]],
    camera_config: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cv2, np = load_opencv()
    cameras = {camera["camera_id"]: camera for camera in enabled_cameras(camera_config)}
    points_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for observation in observations:
        camera_id = str(observation.get("camera_id") or "")
        camera = cameras.get(camera_id)
        projection = projection_matrix(camera)
        if camera is None or projection is None:
            continue
        for point in observation.get("keypoints") or []:
            score = float(point.get("score") or 0)
            name = str(point.get("name") or "")
            if name not in KEYPOINT_NAMES or score < TRIANGULATION_POINT_SCORE_THRESHOLD:
                continue
            points_by_name[name].append(
                {
                    "camera_id": camera_id,
                    "projection": projection,
                    "x": float(point.get("x") or 0),
                    "y": float(point.get("y") or 0),
                    "score": score,
                }
            )

    keypoints = []
    for name in KEYPOINT_NAMES:
        observations_for_joint = sorted(points_by_name.get(name, []), key=lambda item: item["score"], reverse=True)
        estimates = []
        for first, second in itertools.combinations(observations_for_joint[:3], 2):
            point = triangulate_pair(cv2, np, first, second)
            if point is not None:
                weight = (first["score"] + second["score"]) / 2
                estimates.append((point, weight))
        if not estimates:
            continue
        total_weight = sum(weight for _, weight in estimates) or 1
        x = sum(point[0] * weight for point, weight in estimates) / total_weight
        y = sum(point[1] * weight for point, weight in estimates) / total_weight
        z = sum(point[2] * weight for point, weight in estimates) / total_weight
        keypoints.append(
            {
                "name": name,
                "x": round(float(x), 5),
                "y": round(float(y), 5),
                "z": round(float(z), 5),
                "score": round(total_weight / len(estimates), 3),
            }
        )
    return keypoints


def load_opencv() -> tuple[Any, Any]:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore

        return cv2, np
    except Exception as exc:
        raise ValueError("opencv_unavailable") from exc


def projection_matrix(camera: dict[str, Any] | None) -> list[list[float]] | None:
    if not camera:
        return None
    matrix = camera.get("projection_matrix") or camera.get("projectionMatrix")
    calibration = camera.get("calibration") if isinstance(camera.get("calibration"), dict) else {}
    matrix = matrix or calibration.get("projection_matrix") or calibration.get("projectionMatrix")
    if not isinstance(matrix, list) or len(matrix) != 3:
        return None
    normalized = []
    for row in matrix:
        if not isinstance(row, list) or len(row) != 4:
            return None
        normalized.append([float(value) for value in row])
    return normalized


def camera_ready_for_3d(camera: dict[str, Any]) -> bool:
    return bool(camera.get("calibrated")) and projection_matrix(camera) is not None


def triangulate_pair(cv2: Any, np: Any, first: dict[str, Any], second: dict[str, Any]) -> tuple[float, float, float] | None:
    first_projection = np.array(first["projection"], dtype=np.float64)
    second_projection = np.array(second["projection"], dtype=np.float64)
    first_point = np.array([[first["x"]], [first["y"]]], dtype=np.float64)
    second_point = np.array([[second["x"]], [second["y"]]], dtype=np.float64)
    homogeneous = cv2.triangulatePoints(first_projection, second_projection, first_point, second_point)
    divisor = float(homogeneous[3][0])
    if abs(divisor) < 1e-9:
        return None
    coords = homogeneous[:3, 0] / divisor
    return float(coords[0]), float(coords[1]), float(coords[2])
