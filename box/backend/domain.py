from __future__ import annotations

import base64
import dataclasses
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import binascii
import math
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Any

try:
    from profile_input import validate_profile_patch
except ModuleNotFoundError:
    from backend.profile_input import validate_profile_patch


SECRET = os.environ.get("BOXING_COACH_TOKEN_SECRET") or secrets.token_urlsafe(48)
SCHEMA_VERSION = 1
ROLES = {"OWNER", "PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"}


class MigrationRequired(RuntimeError):
    pass


def locked(method):
    @wraps(method)
    def run(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)
    return run


@dataclasses.dataclass
class Gym:
    id: str
    name: str
    code: str


@dataclasses.dataclass
class User:
    id: str
    gym_id: str
    username: str
    email: str
    password_hash: str
    role: str
    name: str
    status: str = "ACTIVE"
    token_version: int = 1


@dataclasses.dataclass
class MemberProfile:
    id: str
    user_id: str
    gym_id: str
    name: str
    phone: str
    birthdate: str
    gender: str
    height_cm: int
    weight_kg: int
    reach_cm: int
    stance: str
    injury_note: str
    training_level: int = 1


@dataclasses.dataclass
class TrainingSession:
    id: str
    user_id: str
    gym_id: str
    started_at: float
    ended_at: float | None
    camera_config: list[dict[str, Any]]
    overall_score: int
    focus: str
    feedback_report: str = ""
    created_by: str = ""
    request_id: str | None = None


@dataclasses.dataclass
class CoachLabel:
    id: str
    session_id: str
    owner_id: str
    label: str
    comment: str
    use_for_training: bool
    created_at: float


class Store:
    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self.db_path = str(db_path)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        version = self.conn.execute("pragma user_version").fetchone()[0]
        existing = self.conn.execute("select 1 from sqlite_master where type = 'table'").fetchone()
        if existing and version != SCHEMA_VERSION:
            self.conn.close()
            raise MigrationRequired("Database migration required; stop the worker and use tools/migrate_sqlite.py with an explicit backup and approval.")
        if not existing:
            self.migrate()
        self.conn.execute("pragma foreign_keys = on")
        self.conn.execute("pragma busy_timeout = 5000")

    @contextmanager
    def transaction(self):
        """Nested savepoints keep multi-record operations atomic on the shared connection."""
        with self.lock:
            name = "tx_" + secrets.token_hex(8)
            self.conn.execute(f"savepoint {name}")
            try:
                yield
            except BaseException:
                self.conn.execute(f"rollback to {name}")
                self.conn.execute(f"release {name}")
                raise
            else:
                self.conn.execute(f"release {name}")

    @property
    @locked
    def gyms(self) -> dict[str, Gym]:
        rows = self.conn.execute("select * from gyms").fetchall()
        return {row["id"]: gym_from_row(row) for row in rows}

    @property
    @locked
    def users(self) -> dict[str, User]:
        rows = self.conn.execute("select * from users").fetchall()
        return {row["id"]: user_from_row(row) for row in rows}

    @property
    @locked
    def profiles(self) -> dict[str, MemberProfile]:
        rows = self.conn.execute("select * from member_profiles").fetchall()
        return {row["id"]: profile_from_row(row) for row in rows}


    @property
    @locked
    def sessions(self) -> dict[str, TrainingSession]:
        rows = self.conn.execute("select * from training_sessions order by started_at desc").fetchall()
        return {row["id"]: session_from_row(row) for row in rows}

    @property
    @locked
    def labels(self) -> dict[str, CoachLabel]:
        rows = self.conn.execute("select * from coach_labels order by created_at desc").fetchall()
        return {row["id"]: label_from_row(row) for row in rows}

    def migrate(self) -> None:
        with self.transaction():
            schema = """
                create table if not exists gyms (
                    id text primary key,
                    name text not null,
                    code text not null unique
                );

                create table if not exists users (
                    id text primary key,
                    gym_id text not null,
                    username text not null unique,
                    email text not null default '',
                    password_hash text not null,
                    role text not null check (role in ('OWNER', 'PLATFORM_ADMIN', 'CENTER_OWNER', 'COACH', 'MEMBER')),
                    name text not null,
                    foreign key (gym_id) references gyms(id)
                );

                create table if not exists member_profiles (
                    id text primary key,
                    user_id text not null unique,
                    gym_id text not null,
                    name text not null,
                    phone text not null default '',
                    birthdate text not null default '',
                    gender text not null default '',
                    height_cm integer not null default 170,
                    weight_kg integer not null default 70,
                    reach_cm integer not null default 172,
                    stance text not null default 'orthodox',
                    injury_note text not null default '',
                    training_level integer not null default 1,
                    foreign key (user_id) references users(id),
                    foreign key (gym_id) references gyms(id)
                );

                create table if not exists member_calibrations (
                    id text primary key,
                    profile_id text not null unique,
                    user_id text not null,
                    gym_id text not null,
                    status text not null,
                    completed integer not null,
                    completed_at real not null,
                    sample_count integer not null,
                    estimated_reach_cm integer not null default 0,
                    camera_config text not null,
                    body_scale text not null,
                    calibration text not null,
                    foreign key (profile_id) references member_profiles(id),
                    foreign key (user_id) references users(id),
                    foreign key (gym_id) references gyms(id)
                );

                create table if not exists training_sessions (
                    id text primary key,
                    user_id text not null,
                    gym_id text not null,
                    started_at real not null,
                    ended_at real,
                    camera_config text not null,
                    overall_score integer not null,
                    focus text not null,
                    feedback_report text not null default '',
                    foreign key (user_id) references users(id),
                    foreign key (gym_id) references gyms(id)
                );

                create table if not exists coach_labels (
                    id text primary key,
                    session_id text not null,
                    owner_id text not null,
                    label text not null,
                    comment text not null,
                    use_for_training integer not null,
                    created_at real not null,
                    foreign key (session_id) references training_sessions(id),
                    foreign key (owner_id) references users(id)
                );
                """
            for statement in schema.split(";"):
                if statement.strip():
                    self.conn.execute(statement)
            self.ensure_column("users", "username", "text")
            self.ensure_column("gyms", "code", "text not null default ''")
            self.ensure_column("users", "email", "text not null default ''")
            self.ensure_column("users", "status", "text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED'))")
            self.ensure_column("users", "token_version", "integer not null default 1 check (token_version > 0)")
            self.ensure_column("member_profiles", "phone", "text not null default ''")
            self.ensure_column("member_profiles", "birthdate", "text not null default ''")
            self.ensure_column("member_profiles", "gender", "text not null default ''")
            self.ensure_column("member_profiles", "height_cm", "integer not null default 170")
            self.ensure_column("member_profiles", "weight_kg", "integer not null default 70")
            self.ensure_column("member_profiles", "reach_cm", "integer not null default 172")
            self.ensure_column("member_profiles", "stance", "text not null default 'orthodox'")
            self.ensure_column("member_profiles", "injury_note", "text not null default ''")
            self.ensure_column("member_profiles", "training_level", "integer not null default 1")
            self.ensure_column("training_sessions", "feedback_report", "text not null default ''")
            self.ensure_column("training_sessions", "created_by", "text not null default ''")
            self.ensure_column("training_sessions", "request_id", "text")
            self.conn.execute("create unique index if not exists idx_session_request on training_sessions(created_by, request_id) where request_id is not null")
            self.conn.execute("""create table if not exists account_audit_logs (
                id text primary key, actor_id text not null references users(id),
                target_id text not null references users(id), gym_id text not null references gyms(id),
                action text not null, before_state text not null, after_state text not null, created_at real not null)""")
            self.backfill_usernames()
            self.backfill_gym_codes()
            self.conn.execute("create unique index if not exists idx_users_username on users(username)")
            self.conn.execute("create unique index if not exists idx_gyms_code on gyms(code)")
            self.conn.execute(f"pragma user_version = {SCHEMA_VERSION}")

    def ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = [row["name"] for row in self.conn.execute(f"pragma table_info({table})").fetchall()]
        if column not in columns:
            self.conn.execute(f"alter table {table} add column {column} {definition}")

    def backfill_usernames(self) -> None:
        rows = self.conn.execute("select id, email, username from users").fetchall()
        for index, row in enumerate(rows, start=1):
            if row["username"]:
                continue
            source = row["email"].split("@")[0] if row["email"] else f"user{index}"
            username = normalize_username(source) or f"user{index}"
            while self.find_user_by_username(username) is not None:
                username = f"{username}{index}"
            self.conn.execute("update users set username = ? where id = ?", (username, row["id"]))

    def backfill_gym_codes(self) -> None:
        rows = self.conn.execute("select id, name, code from gyms").fetchall()
        for index, row in enumerate(rows, start=1):
            if row["code"]:
                continue
            code = normalize_center_code(row["id"].replace("gym_", "")) or normalize_center_code(row["name"]) or f"center{index}"
            while self.find_gym_by_code(code) is not None:
                code = f"{code}{index}"
            self.conn.execute("update gyms set code = ? where id = ?", (code, row["id"]))

    @locked
    def find_user_by_username(self, username: str) -> User | None:
        row = self.conn.execute(
            "select * from users where lower(username) = lower(?)",
            (normalize_username(username),),
        ).fetchone()
        return user_from_row(row) if row else None

    @locked
    def find_user_by_email(self, email: str) -> User | None:
        row = self.conn.execute("select * from users where lower(email) = lower(?)", (email.lower(),)).fetchone()
        return user_from_row(row) if row else None

    @locked
    def get_user(self, user_id: str) -> User | None:
        row = self.conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        return user_from_row(row) if row else None

    @locked
    def find_gym_by_code(self, code: str) -> Gym | None:
        row = self.conn.execute(
            "select * from gyms where lower(code) = lower(?)",
            (normalize_center_code(code),),
        ).fetchone()
        return gym_from_row(row) if row else None

    @locked
    def create_gym(self, name: str, code: str = "") -> Gym:
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            raise ValueError("center name must be 1 to 100 characters")
        name = name.strip()
        if not name:
            raise ValueError("center name is required")
        code = normalize_center_code(code) if code else center_code_from_name(name)
        if not code:
            code = f"center{secrets.token_hex(2)}"
        while self.find_gym_by_code(code) is not None:
            code = f"{code}{secrets.token_hex(1)}"
        gym = Gym(id=f"gym_{secrets.token_hex(4)}", name=name, code=code)
        with self.transaction():
            self.conn.execute(
                "insert into gyms (id, name, code) values (?, ?, ?)",
                (gym.id, gym.name, gym.code),
            )
        return gym

    @locked
    def create_user(self, username: str, password: str, role: str, name: str, gym_id: str, email: str = "") -> User:
        if not all(isinstance(value, str) for value in (username, password, role, name, gym_id, email)):
            raise ValueError("account fields must be strings")
        if not 1 <= len(name.strip()) <= 100 or len(email) > 254:
            raise ValueError("invalid account name or email length")
        username = normalize_username(username)
        email = email.strip().lower()
        validate_username(username)
        validate_password(password)
        if role not in ROLES:
            raise ValueError("unsupported account role")
        if not self.conn.execute("select 1 from gyms where id = ?", (gym_id,)).fetchone():
            raise ValueError("center not found")
        if self.find_user_by_username(username) is not None:
            raise ValueError("username already exists")
        if email and self.find_user_by_email(email) is not None:
            raise ValueError("email already exists")
        user = User(
            id=f"user_{secrets.token_hex(4)}",
            gym_id=gym_id,
            username=username,
            email=email,
            password_hash=hash_password(password),
            role=role,
            name=name,
        )
        with self.transaction():
            self.conn.execute(
                """
                insert into users (id, gym_id, username, email, password_hash, role, name)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (user.id, user.gym_id, user.username, user.email, user.password_hash, user.role, user.name),
            )
        return user

    def create_profile(
        self,
        user: User,
        phone: str,
        birthdate: str,
        gender: str,
        height_cm: int = 170,
        weight_kg: int = 70,
        reach_cm: int = 172,
        stance: str = "orthodox",
        injury_note: str = "",
        training_level: int = 1,
    ) -> MemberProfile:
        profile = MemberProfile(
            id=f"profile_{user.id}",
            user_id=user.id,
            gym_id=user.gym_id,
            name=user.name,
            phone=phone,
            birthdate=birthdate,
            gender=gender,
            height_cm=height_cm,
            weight_kg=weight_kg,
            reach_cm=reach_cm,
            stance=stance,
            injury_note=injury_note,
            training_level=normalize_training_level(training_level),
        )
        with self.transaction():
            self.conn.execute(
                """
                insert into member_profiles
                (id, user_id, gym_id, name, phone, birthdate, gender, height_cm, weight_kg, reach_cm, stance, injury_note, training_level)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile.id,
                    profile.user_id,
                    profile.gym_id,
                    profile.name,
                    profile.phone,
                    profile.birthdate,
                    profile.gender,
                    profile.height_cm,
                    profile.weight_kg,
                    profile.reach_cm,
                    profile.stance,
                    profile.injury_note,
                    profile.training_level,
                ),
            )
        return profile

    @locked
    def profile_for_user(self, user_id: str) -> MemberProfile | None:
        row = self.conn.execute("select * from member_profiles where user_id = ?", (user_id,)).fetchone()
        return profile_from_row(row) if row else None

    @locked
    def get_profile(self, profile_id: str) -> MemberProfile | None:
        row = self.conn.execute("select * from member_profiles where id = ?", (profile_id,)).fetchone()
        return profile_from_row(row) if row else None

    def update_profile(self, profile: MemberProfile) -> MemberProfile:
        profile = dataclasses.replace(profile, training_level=normalize_training_level(profile.training_level))
        with self.transaction():
            self.conn.execute(
                """
                update member_profiles
                set name = ?, phone = ?, birthdate = ?, gender = ?, height_cm = ?, weight_kg = ?,
                    reach_cm = ?, stance = ?, injury_note = ?, training_level = ?
                where id = ?
                """,
                (
                    profile.name,
                    profile.phone,
                    profile.birthdate,
                    profile.gender,
                    profile.height_cm,
                    profile.weight_kg,
                    profile.reach_cm,
                    profile.stance,
                    profile.injury_note,
                    profile.training_level,
                    profile.id,
                ),
            )
        return profile

    def patch_profile(self, actor: User, profile_id: str, body: dict) -> MemberProfile:
        with self.transaction():
            current = self.get_user(actor.id)
            profile = self.get_profile(profile_id)
            if current is None or current.token_version != actor.token_version or profile is None or not can_write_training(current, profile):
                raise PermissionError("member is outside your mutation scope")
            if current.role == "MEMBER" and {"reach_cm", "training_level"}.intersection(body):
                raise PermissionError("members cannot change reach or training level")
            values = validate_profile_patch(body)
            if values.get("birthdate", "") is None:
                values["birthdate"] = ""
            return self.update_profile(dataclasses.replace(profile, **values))


    def create_session(self, session: TrainingSession) -> TrainingSession:
        with self.transaction():
            if session.request_id:
                existing = self.conn.execute("select * from training_sessions where created_by = ? and request_id = ?", (session.created_by, session.request_id)).fetchone()
                if existing:
                    previous = session_from_row(existing)
                    if (previous.user_id, previous.gym_id, previous.camera_config, previous.focus) != (session.user_id, session.gym_id, session.camera_config, session.focus):
                        raise ValueError("request_id is already used for a different session request")
                    return previous
            self.conn.execute(
                """
                insert into training_sessions
                (id, user_id, gym_id, started_at, ended_at, camera_config, overall_score, focus, feedback_report, created_by, request_id)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.id,
                    session.user_id,
                    session.gym_id,
                    session.started_at,
                    session.ended_at,
                    json.dumps(session.camera_config, ensure_ascii=False),
                    session.overall_score,
                    session.focus,
                    session.feedback_report,
                    session.created_by,
                    session.request_id,
                ),
            )
        return session

    @locked
    def get_session(self, session_id: str) -> TrainingSession | None:
        row = self.conn.execute("select * from training_sessions where id = ?", (session_id,)).fetchone()
        return session_from_row(row) if row else None

    def end_session(
        self,
        session_id: str,
        ended_at: float,
    ) -> TrainingSession | None:
        with self.transaction():
            self.conn.execute(
                """
                update training_sessions
                set ended_at = coalesce(ended_at, ?)
                where id = ?
                """,
                (ended_at, session_id),
            )
        return self.get_session(session_id)

    def delete_session(self, session_id: str) -> None:
        with self.transaction():
            self.conn.execute("delete from coach_labels where session_id = ?", (session_id,))
            self.conn.execute("delete from training_sessions where id = ?", (session_id,))

    def create_label(self, label: CoachLabel) -> CoachLabel:
        with self.transaction():
            self.conn.execute(
                """
                insert into coach_labels
                (id, session_id, owner_id, label, comment, use_for_training, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    label.id,
                    label.session_id,
                    label.owner_id,
                    label.label,
                    label.comment,
                    1 if label.use_for_training else 0,
                    label.created_at,
                ),
            )
        return label

    @locked
    def labels_for_session(self, session_id: str) -> list[CoachLabel]:
        rows = self.conn.execute(
            "select * from coach_labels where session_id = ? order by created_at desc",
            (session_id,),
        ).fetchall()
        return [label_from_row(row) for row in rows]

    def require_account_admin(self, actor: User) -> User:
        current = self.get_user(actor.id)
        if current is None or current.status != "ACTIVE" or current.token_version != actor.token_version or current.role not in {"OWNER", "CENTER_OWNER", "PLATFORM_ADMIN"}:
            raise PermissionError("active account administrator is required")
        return current

    def create_managed_account(self, actor: User, body: dict[str, Any]) -> User:
        with self.transaction():
            actor = self.require_account_admin(actor)
            role = body.get("role", "MEMBER")
            center_id = body.get("center_id") or actor.gym_id
            if actor.role != "PLATFORM_ADMIN" and (center_id != actor.gym_id or role not in {"COACH", "MEMBER"}):
                raise PermissionError("center owners may create only coaches and members in their center")
            account = self.create_user(body.get("username", ""), body.get("password", ""), role,
                                       body.get("name", ""), center_id, body.get("email", ""))
            self.create_profile(account, "", "", "")
            self.audit_account(actor, account, "ACCOUNT_CREATED", {})
            return account

    def update_account(self, actor: User, target_id: str, body: dict[str, Any]) -> User:
        if not set(body).issubset({"role", "status"}):
            raise ValueError("only role and status may be changed")
        with self.transaction():
            actor = self.require_account_admin(actor)
            target = self.get_user(target_id)
            if target is None:
                raise ValueError("account not found")
            role, status = body.get("role", target.role), body.get("status", target.status)
            if role not in ROLES or status not in {"ACTIVE", "SUSPENDED"}:
                raise ValueError("invalid account role or status")
            if target.id == actor.id and (role != target.role or status != target.status):
                raise PermissionError("cannot change current account access")
            if actor.role != "PLATFORM_ADMIN" and (target.gym_id != actor.gym_id or target.role not in {"COACH", "MEMBER"} or role not in {"COACH", "MEMBER"}):
                raise PermissionError("target account is outside your access scope")
            if (role, status) == (target.role, target.status):
                return target
            self.conn.execute("update users set role=?, status=?, token_version=token_version+1 where id=?", (role, status, target.id))
            updated = self.get_user(target.id)
            self.audit_account(actor, updated, "ACCOUNT_ACCESS_UPDATED", account_access_state(target))
            return updated

    def audit_account(self, actor: User, target: User, action: str, before: dict[str, Any]) -> None:
        self.conn.execute("insert into account_audit_logs values (?, ?, ?, ?, ?, ?, ?, ?)",
                          (secrets.token_hex(16), actor.id, target.id, target.gym_id, action,
                           json.dumps(before), json.dumps(account_access_state(target)), time.time()))

    def revoke_tokens(self, user_id: str) -> None:
        with self.transaction():
            self.conn.execute("update users set token_version=token_version+1 where id=?", (user_id,))


def account_access_state(user: User) -> dict[str, Any]:
    return {"role": user.role, "status": user.status, "token_version": user.token_version}


def normalize_username(username: str) -> str:
    return username.strip().lower()


def normalize_center_code(code: str) -> str:
    return re.sub(r"[^a-z0-9_-]", "", code.strip().lower())[:24]


def center_code_from_name(name: str) -> str:
    code = normalize_center_code(name.replace(" ", "_"))
    return code or f"center{secrets.token_hex(2)}"


def validate_username(username: str) -> None:
    if not re.fullmatch(r"[a-z0-9_]{4,20}", username):
        raise ValueError("username must be 4-20 lowercase letters, numbers, or underscores")


def validate_password(password: str) -> None:
    if not isinstance(password, str) or not 8 <= len(password) <= 256 or re.search(r"[^A-Za-z0-9]", password) is None:
        raise ValueError("password must be 8 to 256 characters and include a special character")


def safe_int(value: Any, default: int = 0) -> int:
    source = default if value is None or value == "" else value
    try:
        return int(source)
    except (TypeError, ValueError):
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    source = default if value is None or value == "" else value
    try:
        return float(source)
    except (TypeError, ValueError):
        return default


def normalize_training_level(value: Any) -> int:
    return max(1, min(5, safe_int(value, 1)))


def decode_json(value: Any, default: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def user_from_row(row: sqlite3.Row) -> User:
    values = dict(row)
    values.setdefault("username", values.get("email", "").split("@")[0])
    values.setdefault("email", "")
    return User(**{key: values[key] for key in ["id", "gym_id", "username", "email", "password_hash", "role", "name", "status", "token_version"]})


def gym_from_row(row: sqlite3.Row) -> Gym:
    values = dict(row)
    values.setdefault("code", normalize_center_code(values["id"].replace("gym_", "")))
    return Gym(**{key: values[key] for key in ["id", "name", "code"]})


def profile_from_row(row: sqlite3.Row) -> MemberProfile:
    values = dict(row)
    defaults = {
        "phone": "",
        "birthdate": "",
        "gender": "",
        "height_cm": 170,
        "weight_kg": 70,
        "reach_cm": 172,
        "stance": "orthodox",
        "injury_note": "",
        "training_level": 1,
    }
    for key, value in defaults.items():
        values.setdefault(key, value)
    values["training_level"] = normalize_training_level(values["training_level"])
    return MemberProfile(**values)


def session_from_row(row: sqlite3.Row) -> TrainingSession:
    values = dict(row)
    values["camera_config"] = decode_json(values["camera_config"], [])
    values.setdefault("feedback_report", "")
    return TrainingSession(**values)


def label_from_row(row: sqlite3.Row) -> CoachLabel:
    values = dict(row)
    values["use_for_training"] = bool(values["use_for_training"])
    return CoachLabel(**values)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return f"{salt}:{base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, stored = password_hash.split(":", 1)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
        return hmac.compare_digest(base64.urlsafe_b64encode(digest).decode(), stored)
    except (ValueError, TypeError, AttributeError):
        return False


def sign_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "gym_id": user.gym_id,
        "role": user.role,
        "ver": user.token_version,
        "exp": int(time.time()) + 60 * 60 * 8,
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def read_token(token: str) -> dict[str, Any]:
    try:
        if not isinstance(token, str) or len(token) > 4096:
            raise ValueError("invalid token")
        raw, sig = token.split(".", 1)
        expected = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("invalid signature")
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        if not isinstance(payload, dict) or not isinstance(payload.get("sub"), str):
            raise ValueError("invalid claims")
        expiry = payload.get("exp")
        if isinstance(expiry, bool) or not isinstance(expiry, (float, int)) or not math.isfinite(expiry) or expiry <= time.time():
            raise ValueError("expired token")
        if not isinstance(payload.get("ver"), int) or payload["ver"] < 1:
            raise ValueError("invalid token version")
    except (ValueError, TypeError, KeyError, UnicodeError, binascii.Error) as exc:
        raise PermissionError("invalid or expired token") from exc
    return payload


def serialize(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return dataclasses.asdict(value)
    if isinstance(value, list):
        return [serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize(item) for key, item in value.items()}
    return value


def can_read_profile(actor: User, profile: MemberProfile) -> bool:
    if actor.status != "ACTIVE":
        return False
    if actor.role == "PLATFORM_ADMIN":
        return True
    if actor.role in {"OWNER", "CENTER_OWNER", "COACH"}:
        return actor.gym_id == profile.gym_id
    return actor.role == "MEMBER" and actor.id == profile.user_id and actor.gym_id == profile.gym_id


def can_read_session(actor: User, session: TrainingSession) -> bool:
    if actor.status != "ACTIVE":
        return False
    if actor.role == "PLATFORM_ADMIN":
        return True
    if actor.role in {"OWNER", "CENTER_OWNER", "COACH"}:
        return actor.gym_id == session.gym_id
    return actor.role == "MEMBER" and actor.id == session.user_id and actor.gym_id == session.gym_id


def can_write_training(actor: User, record: MemberProfile | TrainingSession) -> bool:
    return actor.role != "PLATFORM_ADMIN" and can_read_profile(actor, record)
