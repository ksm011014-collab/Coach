"""Shared HTTP boundary and the currently available device capabilities."""
import os
from urllib.parse import urlsplit

ENGINE_VERSION = "0.3.0"


def capabilities(data_mode: str, *, local: bool) -> dict:
    return {
        "contract_version": 1,
        "engine_version": ENGINE_VERSION,
        "data_mode": data_mode,
        "analysis": {"available": False, "status": "not_installed"},
        "motion_reports": {"versions": [1], "source": "device_estimate"},
        "camera": {"owner": "device", "capture": "browser"},
        "recording_conversion": {"owner": "local_worker", "route_available": local},
    }


def request_origin_allowed(headers, port: int) -> bool:
    origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"}
    for value in os.environ.get("BOXING_COACH_ALLOWED_ORIGINS", "").split(","):
        value = value.strip().rstrip("/")
        if not value:
            continue
        try:
            parsed = urlsplit(value)
            parsed.port  # Validate an explicit numeric port even when it is unused.
        except ValueError:
            return False
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        origins.add(value)
    authorities = {urlsplit(origin).netloc.lower() for origin in origins}
    if hasattr(headers, "get_all") and (len(headers.get_all("Host", [])) != 1 or len(headers.get_all("Origin", [])) > 1):
        return False
    if headers.get("Host", "").lower() not in authorities:
        return False
    origin = headers.get("Origin")
    if origin is not None:
        return origin in origins
    return headers.get("Sec-Fetch-Site", "") != "cross-site"
