"""Explicit, offline SQLite upgrade. No source database is opened by importing this module."""
from __future__ import annotations

import argparse
import sqlite3
import sys
import threading
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.domain import SCHEMA_VERSION, Store


def upgrade_database(database: Path, backup: Path) -> bool:
    database = database.resolve(strict=True)
    backup = backup.resolve()
    if backup.exists() or backup == database:
        raise ValueError("Backup must be a new file distinct from the source database")
    source = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    try:
        version = source.execute("pragma user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return False
        if version not in (0, 1, 2):
            raise ValueError("Unsupported SQLite schema version")
        # Reserve the path atomically: a concurrently created backup must never
        # be overwritten between the existence check and sqlite3.connect.
        with backup.open("xb"):
            pass
        with closing(sqlite3.connect(backup)) as destination:
            source.backup(destination)
            if destination.execute("pragma integrity_check").fetchone()[0] != "ok":
                raise ValueError("Backup integrity check failed")
    finally:
        source.close()
    store = Store.__new__(Store)
    store.db_path = str(database)
    store.lock = threading.RLock()
    store.conn = sqlite3.connect(database)
    store.conn.row_factory = sqlite3.Row
    try:
        # Legacy tables are retained; only the account table needs a broader role constraint.
        with store.transaction():
            store.migrate()
            schema = store.conn.execute("select sql from sqlite_master where name='users'").fetchone()[0]
            if "PLATFORM_ADMIN" not in schema:
                store.conn.execute("""create table users_upgrade (
                    id text primary key, gym_id text not null references gyms(id),
                    username text not null unique, email text not null default '',
                    password_hash text not null, role text not null
                    check (role in ('OWNER','PLATFORM_ADMIN','CENTER_OWNER','COACH','MEMBER')),
                    name text not null, status text not null default 'ACTIVE'
                    check (status in ('ACTIVE','SUSPENDED')),
                    token_version integer not null default 1 check (token_version > 0))""")
                store.conn.execute("insert into users_upgrade select id,gym_id,username,email,password_hash,role,name,status,token_version from users")
                store.conn.execute("drop table users")
                store.conn.execute("alter table users_upgrade rename to users")
                store.conn.execute("create unique index idx_users_username on users(username)")
                store.conn.execute("create unique index idx_users_center_identity on users(id, gym_id)")
            if store.conn.execute("pragma foreign_key_check").fetchone():
                raise ValueError("Legacy data has invalid foreign keys; migration rolled back")
    finally:
        store.conn.close()
    return True


def main():
    parser = argparse.ArgumentParser(description="Stop the worker, approve the upgrade, and create a verified backup before SQLite migration.")
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--approve-migration", required=True, action="store_true")
    args = parser.parse_args()
    changed = upgrade_database(args.database, args.backup)
    print("SQLite migration complete; backup retained." if changed else "Schema is already current; no migration or backup was created.")


if __name__ == "__main__":
    main()
