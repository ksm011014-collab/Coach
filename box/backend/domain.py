from __future__ import annotations

import base64
import dataclasses
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


SECRET = "local-mvp-development-secret"


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
        self.migrate()
        self.seed()

    @property
    def gyms(self) -> dict[str, Gym]:
        rows = self.conn.execute("select * from gyms").fetchall()
        return {row["id"]: gym_from_row(row) for row in rows}

    @property
    def users(self) -> dict[str, User]:
        rows = self.conn.execute("select * from users").fetchall()
        return {row["id"]: user_from_row(row) for row in rows}

    @property
    def profiles(self) -> dict[str, MemberProfile]:
        rows = self.conn.execute("select * from member_profiles").fetchall()
        return {row["id"]: profile_from_row(row) for row in rows}

    @property
    def sessions(self) -> dict[str, TrainingSession]:
        rows = self.conn.execute("select * from training_sessions order by started_at desc").fetchall()
        return {row["id"]: session_from_row(row) for row in rows}

    @property
    def labels(self) -> dict[str, CoachLabel]:
        rows = self.conn.execute("select * from coach_labels order by created_at desc").fetchall()
        return {row["id"]: label_from_row(row) for row in rows}

    def migrate(self) -> None:
        with self.lock, self.conn:
            self.conn.executescript(
                """
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
                    role text not null check (role in ('OWNER', 'MEMBER')),
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
            )
            self.ensure_column("users", "username", "text")
            self.ensure_column("gyms", "code", "text not null default ''")
            self.ensure_column("users", "email", "text not null default ''")
            self.ensure_column("member_profiles", "phone", "text not null default ''")
            self.ensure_column("member_profiles", "birthdate", "text not null default ''")
            self.ensure_column("member_profiles", "gender", "text not null default ''")
            self.ensure_column("member_profiles", "height_cm", "integer not null default 170")
            self.ensure_column("member_profiles", "weight_kg", "integer not null default 70")
            self.ensure_column("member_profiles", "reach_cm", "integer not null default 172")
            self.ensure_column("member_profiles", "stance", "text not null default 'orthodox'")
            self.ensure_column("member_profiles", "injury_note", "text not null default ''")
            self.ensure_column("training_sessions", "feedback_report", "text not null default ''")
            self.backfill_usernames()
            self.backfill_gym_codes()
            self.conn.execute("create unique index if not exists idx_users_username on users(username)")
            self.conn.execute("create unique index if not exists idx_gyms_code on gyms(code)")

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

    def seed(self) -> None:
        with self.lock, self.conn:
            self.conn.execute(
                "insert or ignore into gyms (id, name, code) values (?, ?, ?)",
                ("gym_apex", "APEX Boxing Lab", "apex"),
            )
        owner = self.find_user_by_username("owner")
        if owner is None:
            owner = self.create_user("owner", "Owner!123", "OWNER", "김관리자", "gym_apex")
            self.create_profile(owner, "010-0000-0001", "1985-01-01", "male")
        else:
            self.update_seed_password(owner, "Owner!123")
        member = self.find_user_by_username("member")
        if member is None:
            member = self.create_user("member", "Member!123", "MEMBER", "이회원", "gym_apex")
            self.create_profile(member, "010-0000-0002", "1995-01-01", "female")
        else:
            self.update_seed_password(member, "Member!123")

    def update_seed_password(self, user: User, password: str) -> None:
        with self.lock, self.conn:
            self.conn.execute(
                "update users set password_hash = ? where id = ?",
                (hash_password(password), user.id),
            )

    def find_user_by_username(self, username: str) -> User | None:
        row = self.conn.execute(
            "select * from users where lower(username) = lower(?)",
            (normalize_username(username),),
        ).fetchone()
        return user_from_row(row) if row else None

    def find_user_by_email(self, email: str) -> User | None:
        row = self.conn.execute("select * from users where lower(email) = lower(?)", (email.lower(),)).fetchone()
        return user_from_row(row) if row else None

    def get_user(self, user_id: str) -> User | None:
        row = self.conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        return user_from_row(row) if row else None

    def find_gym_by_code(self, code: str) -> Gym | None:
        row = self.conn.execute(
            "select * from gyms where lower(code) = lower(?)",
            (normalize_center_code(code),),
        ).fetchone()
        return gym_from_row(row) if row else None

    def create_gym(self, name: str, code: str = "") -> Gym:
        name = name.strip()
        if not name:
            raise ValueError("center name is required")
        code = normalize_center_code(code) if code else center_code_from_name(name)
        if not code:
            code = f"center{secrets.token_hex(2)}"
        while self.find_gym_by_code(code) is not None:
            code = f"{code}{secrets.token_hex(1)}"
        gym = Gym(id=f"gym_{secrets.token_hex(4)}", name=name, code=code)
        with self.lock, self.conn:
            self.conn.execute(
                "insert into gyms (id, name, code) values (?, ?, ?)",
                (gym.id, gym.name, gym.code),
            )
        return gym

    def create_user(self, username: str, password: str, role: str, name: str, gym_id: str, email: str = "") -> User:
        username = normalize_username(username)
        email = email.strip().lower()
        validate_username(username)
        validate_password(password)
        if role not in {"OWNER", "MEMBER"}:
            raise ValueError("role must be OWNER or MEMBER")
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
        with self.lock, self.conn:
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
        )
        with self.lock, self.conn:
            self.conn.execute(
                """
                insert or replace into member_profiles
                (id, user_id, gym_id, name, phone, birthdate, gender, height_cm, weight_kg, reach_cm, stance, injury_note)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                ),
            )
        return profile

    def profile_for_user(self, user_id: str) -> MemberProfile | None:
        row = self.conn.execute("select * from member_profiles where user_id = ?", (user_id,)).fetchone()
        return profile_from_row(row) if row else None

    def get_profile(self, profile_id: str) -> MemberProfile | None:
        row = self.conn.execute("select * from member_profiles where id = ?", (profile_id,)).fetchone()
        return profile_from_row(row) if row else None

    def update_profile(self, profile: MemberProfile) -> MemberProfile:
        with self.lock, self.conn:
            self.conn.execute(
                """
                update member_profiles
                set name = ?, phone = ?, birthdate = ?, gender = ?, height_cm = ?, weight_kg = ?,
                    reach_cm = ?, stance = ?, injury_note = ?
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
                    profile.id,
                ),
            )
        return profile

    def create_session(self, session: TrainingSession) -> TrainingSession:
        with self.lock, self.conn:
            self.conn.execute(
                """
                insert into training_sessions
                (id, user_id, gym_id, started_at, ended_at, camera_config, overall_score, focus, feedback_report)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                ),
            )
        return session

    def get_session(self, session_id: str) -> TrainingSession | None:
        row = self.conn.execute("select * from training_sessions where id = ?", (session_id,)).fetchone()
        return session_from_row(row) if row else None

    def end_session(
        self,
        session_id: str,
        ended_at: float,
        overall_score: int,
        feedback_report: str = "",
    ) -> TrainingSession | None:
        with self.lock, self.conn:
            self.conn.execute(
                """
                update training_sessions
                set ended_at = ?, overall_score = ?, feedback_report = ?
                where id = ?
                """,
                (ended_at, overall_score, feedback_report, session_id),
            )
        return self.get_session(session_id)

    def delete_session(self, session_id: str) -> None:
        with self.lock, self.conn:
            self.conn.execute("delete from coach_labels where session_id = ?", (session_id,))
            self.conn.execute("delete from training_sessions where id = ?", (session_id,))

    def create_label(self, label: CoachLabel) -> CoachLabel:
        with self.lock, self.conn:
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

    def labels_for_session(self, session_id: str) -> list[CoachLabel]:
        rows = self.conn.execute(
            "select * from coach_labels where session_id = ? order by created_at desc",
            (session_id,),
        ).fetchall()
        return [label_from_row(row) for row in rows]


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
    if len(password) < 8 or re.search(r"[^A-Za-z0-9]", password) is None:
        raise ValueError("password must be at least 8 characters and include a special character")


def user_from_row(row: sqlite3.Row) -> User:
    values = dict(row)
    values.setdefault("username", values.get("email", "").split("@")[0])
    values.setdefault("email", "")
    return User(**{key: values[key] for key in ["id", "gym_id", "username", "email", "password_hash", "role", "name"]})


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
    }
    for key, value in defaults.items():
        values.setdefault(key, value)
    return MemberProfile(**values)


def session_from_row(row: sqlite3.Row) -> TrainingSession:
    values = dict(row)
    values["camera_config"] = json.loads(values["camera_config"])
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
    salt, stored = password_hash.split(":", 1)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return hmac.compare_digest(base64.urlsafe_b64encode(digest).decode(), stored)


def sign_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "gym_id": user.gym_id,
        "role": user.role,
        "exp": int(time.time()) + 60 * 60 * 8,
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def read_token(token: str) -> dict[str, Any]:
    try:
        raw, sig = token.split(".", 1)
    except ValueError as exc:
        raise PermissionError("invalid token") from exc
    expected = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise PermissionError("invalid token signature")
    payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
    if payload["exp"] < time.time():
        raise PermissionError("token expired")
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
    if actor.role == "OWNER":
        return actor.gym_id == profile.gym_id
    return actor.id == profile.user_id


def can_read_session(actor: User, session: TrainingSession) -> bool:
    if actor.role == "OWNER":
        return actor.gym_id == session.gym_id
    return actor.id == session.user_id
