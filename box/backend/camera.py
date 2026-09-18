from typing import Any


def normalize_camera_config(raw_config: Any) -> list[dict[str, Any]]:
    """Keep capture metadata only; never propagate analysis data into new sessions."""
    cameras = raw_config.get("cameras", []) if isinstance(raw_config, dict) else raw_config
    if not isinstance(cameras, list) or not cameras:
        cameras = [{"camera_id": "cam_front_01"}]
    return [
        {
            "camera_id": str(camera.get("camera_id") or f"cam_{index + 1}"),
            "label": str(camera.get("label") or ""),
            "view_angle": str(camera.get("view_angle") or "front"),
            "device_id": str(camera.get("device_id") or ""),
            "enabled": bool(camera.get("enabled", True)),
        }
        for index, camera in enumerate(cameras[:3]) if isinstance(camera, dict)
    ]
