from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


TABLES = (
    "gyms",
    "users",
    "member_profiles",
    "member_calibrations",
    "training_sessions",
    "coach_labels",
)

REFERENCE_RULES = {
    "users": (("gym_id", "gyms"),),
    "member_profiles": (("user_id", "users"), ("gym_id", "gyms")),
    "member_calibrations": (
        ("profile_id", "member_profiles"),
        ("user_id", "users"),
        ("gym_id", "gyms"),
    ),
    "training_sessions": (("user_id", "users"), ("gym_id", "gyms")),
    "coach_labels": (("session_id", "training_sessions"), ("owner_id", "users")),
}


def build_migration_plan(bundle: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    if bundle.get("format") != "boxing-coach-sqlite-export":
        errors.append("unsupported export format")
    if bundle.get("password_migration") != "reset_required":
        errors.append("password migration must require a reset")
    tables = bundle.get("tables")
    if not isinstance(tables, dict):
        tables = {}
        errors.append("tables must be an object")

    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    ids_by_table: dict[str, set[str]] = {}
    for table in TABLES:
        rows = tables.get(table, [])
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            errors.append(f"{table} must be an array of objects")
            rows = []
        rows_by_table[table] = rows
        identifiers = [str(row.get("id") or "") for row in rows]
        if any(not identifier for identifier in identifiers):
            errors.append(f"{table} contains a row without an id")
        duplicates = [identifier for identifier, count in Counter(identifiers).items() if identifier and count > 1]
        if duplicates:
            errors.append(f"{table} contains duplicate ids: {', '.join(sorted(duplicates))}")
        ids_by_table[table] = {identifier for identifier in identifiers if identifier}

    for user in rows_by_table["users"]:
        if "password_hash" in user:
            errors.append(f"users row {user.get('id')} contains a password hash")
        if user.get("password_reset_required") is not True:
            errors.append(f"users row {user.get('id')} does not require a password reset")

    usernames = [str(row.get("username") or "").lower() for row in rows_by_table["users"]]
    duplicate_usernames = [value for value, count in Counter(usernames).items() if value and count > 1]
    if duplicate_usernames:
        errors.append(f"duplicate usernames: {', '.join(sorted(duplicate_usernames))}")
    center_codes = [str(row.get("code") or "").lower() for row in rows_by_table["gyms"]]
    duplicate_codes = [value for value, count in Counter(center_codes).items() if value and count > 1]
    if duplicate_codes:
        errors.append(f"duplicate center codes: {', '.join(sorted(duplicate_codes))}")

    for table, rules in REFERENCE_RULES.items():
        for row in rows_by_table[table]:
            for field, target_table in rules:
                reference = str(row.get(field) or "")
                if not reference or reference not in ids_by_table[target_table]:
                    errors.append(
                        f"{table}.{field} for {row.get('id')} references missing {target_table} id {reference or '<empty>'}"
                    )

    member_counts = Counter(str(row.get("gym_id") or "") for row in rows_by_table["member_profiles"])
    session_counts = Counter(str(row.get("gym_id") or "") for row in rows_by_table["training_sessions"])
    centers = []
    for center in rows_by_table["gyms"]:
        legacy_id = str(center["id"])
        centers.append(
            {
                "legacy_id": legacy_id,
                "name": center.get("name") or "",
                "code": center.get("code") or "",
                "member_profiles": member_counts[legacy_id],
                "training_sessions": session_counts[legacy_id],
                "supabase_id": None,
            }
        )

    if not rows_by_table["gyms"]:
        warnings.append("the export contains no centers")
    if not rows_by_table["users"]:
        warnings.append("the export contains no accounts")

    return {
        "format": "boxing-coach-supabase-migration-plan",
        "version": 1,
        "source": bundle.get("source") or "",
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {table: len(rows_by_table[table]) for table in TABLES},
        "phases": [
            "centers",
            "supabase_auth_accounts",
            "member_profiles",
            "member_calibrations",
            "training_sessions",
            "coach_labels",
            "role_and_tenant_verification",
        ],
        "center_mappings": centers,
        "account_mappings": [
            {
                "legacy_id": row["id"],
                "username": row.get("username") or "",
                "legacy_center_id": row.get("gym_id") or "",
                "supabase_auth_id": None,
                "temporary_password_issued": False,
            }
            for row in rows_by_table["users"]
        ],
        "profile_mappings": [
            {
                "legacy_id": row["id"],
                "legacy_user_id": row.get("user_id") or "",
                "supabase_id": None,
            }
            for row in rows_by_table["member_profiles"]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate a password-safe SQLite export and create a staging migration mapping plan."
    )
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    bundle = json.loads(arguments.bundle.read_text(encoding="utf-8"))
    plan = build_migration_plan(bundle)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(arguments.output.resolve()),
                "valid": plan["valid"],
                "counts": plan["counts"],
                "error_count": len(plan["errors"]),
            },
            ensure_ascii=False,
        )
    )
    if not plan["valid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
