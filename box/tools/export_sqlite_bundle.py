from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any


JSON_COLUMNS = {
    "member_calibrations": {"camera_config", "body_scale", "calibration"},
    "training_sessions": {"camera_config", "feedback_report"},
}


def export_bundle(database_path: Path) -> dict[str, Any]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        tables = existing_tables(connection)
        bundle: dict[str, Any] = {
            "format": "boxing-coach-sqlite-export",
            "version": 1,
            "source": str(database_path.resolve()),
            "password_migration": "reset_required",
            "tables": {},
        }
        for table in (
            "gyms",
            "users",
            "member_profiles",
            "member_calibrations",
            "training_sessions",
            "coach_labels",
        ):
            if table not in tables:
                bundle["tables"][table] = []
                continue
            rows = connection.execute(f"select * from {table}").fetchall()
            bundle["tables"][table] = [export_row(table, row) for row in rows]
        return bundle
    finally:
        connection.close()


def existing_tables(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute("select name from sqlite_master where type = 'table'").fetchall()
    return {str(row[0]) for row in rows}


def export_row(table: str, row: sqlite3.Row) -> dict[str, Any]:
    values = dict(row)
    if table == "users":
        values.pop("password_hash", None)
        values["password_reset_required"] = True
    for column in JSON_COLUMNS.get(table, set()):
        value = values.get(column)
        if not isinstance(value, str) or not value:
            continue
        try:
            values[column] = json.loads(value)
        except json.JSONDecodeError:
            values[column] = value
    return values


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the local BoxingCoach SQLite database for controlled Supabase migration."
    )
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if not arguments.database.is_file():
        parser.error(f"database not found: {arguments.database}")

    bundle = export_bundle(arguments.database)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    counts = {table: len(rows) for table, rows in bundle["tables"].items()}
    print(json.dumps({"output": str(arguments.output.resolve()), "counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
