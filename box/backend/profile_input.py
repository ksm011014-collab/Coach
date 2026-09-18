"""Validation shared by local and central profile patch APIs."""
from datetime import date


def validate_profile_patch(body: dict) -> dict:
    text_limits = {"name": 100, "phone": 40, "gender": 40, "injury_note": 2000}
    ranges = {"height_cm": (100, 250), "weight_kg": (25, 300), "reach_cm": (0, 300), "training_level": (1, 5)}
    allowed = set(text_limits) | set(ranges) | {"birthdate", "stance"}
    if not isinstance(body, dict) or not set(body).issubset(allowed):
        raise ValueError("unsupported profile fields")
    values = dict(body)
    for key, value in values.items():
        if key in text_limits:
            if not isinstance(value, str) or len(value) > text_limits[key] or (key == "name" and not value.strip()):
                raise ValueError(f"invalid {key}")
        elif key in ranges:
            low, high = ranges[key]
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise ValueError(f"invalid {key}")
        elif key == "stance" and value not in ("orthodox", "southpaw"):
            raise ValueError("invalid stance")
        elif key == "birthdate" and value not in (None, ""):
            if not isinstance(value, str) or len(value) != 10:
                raise ValueError("invalid birthdate")
            date.fromisoformat(value)
    return values
