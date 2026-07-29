from __future__ import annotations

import argparse
from contextlib import contextmanager
import asyncio
import datetime as dt
import json
import os
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import AppConfig, load_config
from .database import Database
from .refresh_control import (
    WORKFLOW_LABELS,
    all_freshness,
    cancel_job,
    current_week_window,
    queue_job,
)

UTC = dt.timezone.utc
DISCORD_API = "https://discord.com/api/v10"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"


class TokenRequest(BaseModel):
    code: str = Field(min_length=1, max_length=4096)


class RefreshRequest(BaseModel):
    job_type: str
    idle_required: bool = True


@dataclass(frozen=True)
class Identity:
    user_id: str
    username: str
    global_name: str | None
    avatar: str | None
    is_admin: bool
    is_viewer: bool
    dev_bypass: bool = False


@dataclass
class CachedIdentity:
    expires_at: float
    identity: Identity


class ActivityRuntime:
    def __init__(self, config_path: str | Path):
        self.config_path = Path(config_path).resolve()
        self.root = self.config_path.parent
        self.config = load_config(self.config_path)
        db_path = self.config.database.path
        self.database_path = (
            db_path if db_path.is_absolute() else self.root / db_path
        ).resolve()
        self.static_dir = self.root / "activity" / "dist"
        self.client_id = os.environ.get("DISCORD_CLIENT_ID", "").strip()
        self.client_secret = os.environ.get(
            "DISCORD_CLIENT_SECRET", ""
        ).strip()
        self.dev_user_id = os.environ.get(
            "DARKWAR_ACTIVITY_DEV_USER_ID", "local-dev"
        ).strip() or "local-dev"
        self._cache: dict[str, CachedIdentity] = {}
        self._cache_lock = threading.Lock()

        database = Database(
            self.database_path,
            top_n=self.config.tracking.top_n,
        )
        database.close()

    @property
    def activity_config(self):
        return self.config.discord_activity

    @contextmanager
    def open_db(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(
            self.database_path,
            timeout=30,
            check_same_thread=False,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    def localize(self, value: Any) -> str | None:
        parsed = parse_time(value)
        if parsed is None:
            return None
        try:
            zone = ZoneInfo(self.activity_config.timezone)
        except Exception:
            zone = UTC
        return parsed.astimezone(zone).isoformat()

    async def exchange_code(self, code: str) -> dict[str, Any]:
        if not self.client_id or not self.client_secret:
            raise HTTPException(
                status_code=503,
                detail=(
                    "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are not "
                    "configured on the Activity server."
                ),
            )
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                DISCORD_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "authorization_code",
                    "code": code,
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded"
                },
            )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail="Discord OAuth token exchange failed.",
            )
        payload = response.json()
        access_token = str(payload.get("access_token") or "")
        if not access_token:
            raise HTTPException(
                status_code=502,
                detail="Discord did not return an access token.",
            )
        return {
            "access_token": access_token,
            "token_type": payload.get("token_type", "Bearer"),
            "expires_in": payload.get("expires_in"),
            "scope": payload.get("scope", "identify"),
        }

    def permission_for(self, user_id: str) -> tuple[bool, bool]:
        activity = self.activity_config
        admin_ids = set(activity.admin_user_ids)
        viewer_ids = set(activity.viewer_user_ids)
        is_admin = user_id in admin_ids
        if not admin_ids and not viewer_ids:
            is_viewer = True
        else:
            is_viewer = is_admin or user_id in viewer_ids
        return is_viewer, is_admin

    async def identity_from_token(self, token: str) -> Identity:
        now = time.monotonic()
        with self._cache_lock:
            cached = self._cache.get(token)
            if cached and cached.expires_at > now:
                return cached.identity

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{DISCORD_API}/users/@me",
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="Discord authorization expired. Reopen the Activity.",
            )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail="Could not verify the Discord user.",
            )
        user = response.json()
        user_id = str(user.get("id") or "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid Discord user.")
        is_viewer, is_admin = self.permission_for(user_id)
        identity = Identity(
            user_id=user_id,
            username=str(user.get("username") or user_id),
            global_name=(
                str(user["global_name"])
                if user.get("global_name") is not None
                else None
            ),
            avatar=(
                str(user["avatar"])
                if user.get("avatar") is not None
                else None
            ),
            is_admin=is_admin,
            is_viewer=is_viewer,
        )
        with self._cache_lock:
            self._cache[token] = CachedIdentity(
                expires_at=now + 300,
                identity=identity,
            )
        return identity


def parse_time(value: Any) -> dt.datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        is not None
    )


def scalar(
    connection: sqlite3.Connection,
    sql: str,
    params: tuple[Any, ...] = (),
    default: Any = None,
) -> Any:
    row = connection.execute(sql, params).fetchone()
    return row[0] if row and row[0] is not None else default


def own_alliance_id(
    connection: sqlite3.Connection,
    config: AppConfig,
) -> str | None:
    code = config.activity.own_alliance_code
    if code:
        row = connection.execute(
            """
            SELECT alliance_id
            FROM alliances
            WHERE UPPER(code) = UPPER(?)
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (code,),
        ).fetchone()
        if row:
            return str(row[0])
    row = connection.execute(
        """
        SELECT alliance_id
        FROM member_snapshots
        WHERE presence_redacted = 0
        ORDER BY snapshot_id DESC
        LIMIT 1
        """
    ).fetchone()
    return str(row[0]) if row else None


def latest_own_alliance(
    connection: sqlite3.Connection,
    config: AppConfig,
) -> dict[str, Any] | None:
    alliance_id = own_alliance_id(connection, config)
    if not alliance_id:
        return None
    row = connection.execute(
        """
        SELECT
            a.alliance_id,
            a.server_id,
            a.code,
            a.full_name,
            a.leader,
            a.latest_fight_power,
            ms.snapshot_id,
            ms.captured_at,
            ms.member_count,
            ms.presence_redacted
        FROM alliances a
        LEFT JOIN member_snapshots ms
          ON ms.snapshot_id = (
              SELECT MAX(inner_ms.snapshot_id)
              FROM member_snapshots inner_ms
              WHERE inner_ms.alliance_id = a.alliance_id
          )
        WHERE a.alliance_id = ?
        """,
        (alliance_id,),
    ).fetchone()
    return row_dict(row)


def freshness_payload(runtime: ActivityRuntime) -> dict[str, Any]:
    now = dt.datetime.now(UTC)
    window = current_week_window(now, runtime.config)
    with runtime.open_db() as connection:
        fresh = all_freshness(
            connection,
            window.reset_at,
            runtime.config,
        )
    return {
        workflow_id: {
            "workflow_id": item.workflow_id,
            "label": WORKFLOW_LABELS.get(workflow_id, workflow_id),
            "latest_at": item.latest_at.isoformat() if item.latest_at else None,
            "latest_local": runtime.localize(item.latest_at),
            "current": item.current,
            "coverage_current": item.coverage_current,
            "coverage_total": item.coverage_total,
            "detail": item.detail,
        }
        for workflow_id, item in fresh.items()
    }


def create_app(config_path: str | Path = "config.toml") -> FastAPI:
    runtime = ActivityRuntime(config_path)
    app = FastAPI(
        title="DarkWar Discord Activity API",
        version="0.4.0",
        docs_url=None,
        redoc_url=None,
    )
    app.state.runtime = runtime

    async def current_identity(
        request: Request,
        authorization: str | None = Header(default=None),
        x_darkwar_dev_bypass: str | None = Header(default=None),
    ) -> Identity:
        rt: ActivityRuntime = request.app.state.runtime
        if (
            rt.activity_config.allow_dev_bypass
            and x_darkwar_dev_bypass == "1"
        ):
            is_viewer, is_admin = rt.permission_for(rt.dev_user_id)
            if not rt.activity_config.admin_user_ids:
                is_admin = True
                is_viewer = True
            return Identity(
                user_id=rt.dev_user_id,
                username="Local developer",
                global_name="Local developer",
                avatar=None,
                is_admin=is_admin,
                is_viewer=is_viewer,
                dev_bypass=True,
            )
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Discord login required.")
        token = authorization.split(" ", 1)[1].strip()
        identity = await rt.identity_from_token(token)
        if not identity.is_viewer:
            raise HTTPException(
                status_code=403,
                detail="This Discord user is not allowed to view the Activity.",
            )
        return identity

    async def admin_identity(
        identity: Identity = Depends(current_identity),
    ) -> Identity:
        if not identity.is_admin:
            raise HTTPException(
                status_code=403,
                detail="Administrator permission is required.",
            )
        return identity

    @app.exception_handler(sqlite3.Error)
    async def sqlite_exception_handler(
        request: Request,
        exc: sqlite3.Error,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": f"SQLite error: {exc}"},
        )

    @app.get("/api/health")
    def health(request: Request) -> dict[str, Any]:
        rt: ActivityRuntime = request.app.state.runtime
        return {
            "ok": True,
            "version": "0.4.0",
            "database_exists": rt.database_path.exists(),
            "activity_enabled": rt.activity_config.enabled,
            "client_id_configured": bool(rt.client_id),
            "client_secret_configured": bool(rt.client_secret),
        }

    @app.get("/api/activity/config")
    def public_config(request: Request) -> dict[str, Any]:
        rt: ActivityRuntime = request.app.state.runtime
        return {
            "client_id": rt.client_id,
            "activity_enabled": rt.activity_config.enabled,
            "dev_bypass": rt.activity_config.allow_dev_bypass,
            "timezone": rt.activity_config.timezone,
            "version": "0.4.0",
        }

    @app.post("/api/token")
    async def token(
        payload: TokenRequest,
        request: Request,
    ) -> dict[str, Any]:
        rt: ActivityRuntime = request.app.state.runtime
        return await rt.exchange_code(payload.code)

    @app.get("/api/session")
    def session(
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        return asdict(identity)

    @app.get("/api/overview")
    def overview(
        request: Request,
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        rt: ActivityRuntime = request.app.state.runtime
        now = dt.datetime.now(UTC)
        window = current_week_window(now, rt.config)
        with rt.open_db() as connection:
            totals: dict[str, Any] = {}
            for key, table in (
                ("alliances", "alliances"),
                ("players", "players"),
                ("member_snapshots", "member_snapshots"),
                ("arena_snapshots", "arena_snapshots"),
                ("profiles", "player_profile_snapshots"),
            ):
                totals[key] = (
                    int(scalar(connection, f"SELECT COUNT(*) FROM {table}", default=0))
                    if table_exists(connection, table)
                    else 0
                )
            latest_capture = (
                connection.execute(
                    """
                    SELECT captured_at, command, direction
                    FROM capture_events
                    ORDER BY event_id DESC
                    LIMIT 1
                    """
                ).fetchone()
                if table_exists(connection, "capture_events")
                else None
            )
            arena_match = (
                connection.execute(
                    """
                    SELECT
                        am.*,
                        ars.captured_at,
                        ars.player_count,
                        ars.own_defense_power
                    FROM arena_matches am
                    LEFT JOIN arena_snapshots ars
                      ON ars.snapshot_id = (
                          SELECT MAX(s2.snapshot_id)
                          FROM arena_snapshots s2
                          WHERE s2.match_id = am.match_id
                      )
                    ORDER BY
                        CASE WHEN am.status = 'active' THEN 0 ELSE 1 END,
                        am.end_time_ms DESC
                    LIMIT 1
                    """
                ).fetchone()
                if table_exists(connection, "arena_matches")
                else None
            )
            jobs = (
                connection.execute(
                    """
                    SELECT
                        job_id, job_type, trigger_type, week_key,
                        requested_at, scheduled_for, status, priority,
                        current_step, attempt_count, last_error,
                        last_activity_at
                    FROM refresh_jobs
                    ORDER BY
                        CASE WHEN status IN (
                            'queued', 'waiting_idle', 'running',
                            'waiting_setup', 'partial'
                        ) THEN 0 ELSE 1 END,
                        job_id DESC
                    LIMIT 12
                    """
                ).fetchall()
                if table_exists(connection, "refresh_jobs")
                else []
            )
            changes = (
                connection.execute(
                    """
                    SELECT
                        mce.detected_at,
                        COALESCE(a.code, '?') AS alliance_code,
                        mce.player_name,
                        mce.player_uid,
                        mce.event_type,
                        mce.numeric_delta,
                        mce.old_value,
                        mce.new_value
                    FROM member_change_events mce
                    LEFT JOIN alliances a
                      ON a.alliance_id = mce.alliance_id
                    ORDER BY mce.event_id DESC
                    LIMIT 12
                    """
                ).fetchall()
                if table_exists(connection, "member_change_events")
                else []
            )
            own = latest_own_alliance(connection, rt.config)

        return {
            "generated_at": now.isoformat(),
            "generated_local": rt.localize(now),
            "week": {
                "key": window.key,
                "reset_at": window.reset_at.isoformat(),
                "reset_local": rt.localize(window.reset_at),
                "scheduled_at": window.scheduled_at.isoformat(),
                "scheduled_local": rt.localize(window.scheduled_at),
                "next_reset_at": window.next_reset_at.isoformat(),
                "next_reset_local": rt.localize(window.next_reset_at),
            },
            "freshness": freshness_payload(rt),
            "totals": totals,
            "latest_capture": row_dict(latest_capture),
            "arena_match": row_dict(arena_match),
            "own_alliance": own,
            "jobs": rows_list(jobs),
            "changes": rows_list(changes),
            "permissions": {
                "is_admin": identity.is_admin,
                "is_viewer": identity.is_viewer,
            },
        }

    @app.get("/api/arena")
    def arena(
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
        server_id: int | None = Query(default=None),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        limit = min(limit, rt.activity_config.max_rows)
        with rt.open_db() as connection:
            match = connection.execute(
                """
                SELECT *
                FROM arena_matches
                ORDER BY
                    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                    end_time_ms DESC
                LIMIT 1
                """
            ).fetchone()
            if not match:
                return {"match": None, "snapshot": None, "entries": [], "servers": []}
            snapshot = connection.execute(
                """
                SELECT *
                FROM arena_snapshots
                WHERE match_id = ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (match["match_id"],),
            ).fetchone()
            if not snapshot:
                return {"match": dict(match), "snapshot": None, "entries": [], "servers": []}
            previous = connection.execute(
                """
                SELECT snapshot_id
                FROM arena_snapshots
                WHERE match_id = ? AND snapshot_id < ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (match["match_id"], snapshot["snapshot_id"]),
            ).fetchone()
            params: list[Any] = [snapshot["snapshot_id"]]
            server_clause = ""
            if server_id is not None:
                server_clause = " AND current.server_id = ?"
                params.append(server_id)
            params.append(limit)
            previous_id = previous[0] if previous else -1
            entries = connection.execute(
                f"""
                SELECT
                    current.arena_rank,
                    current.score,
                    current.power,
                    current.server_id,
                    current.current_server_id,
                    current.player_uid,
                    current.player_name,
                    current.alliance_code,
                    current.alliance_name,
                    current.country,
                    previous.arena_rank AS previous_rank,
                    previous.score AS previous_score,
                    previous.power AS previous_power,
                    CASE
                        WHEN previous.arena_rank IS NULL THEN NULL
                        ELSE previous.arena_rank - current.arena_rank
                    END AS rank_change,
                    CASE
                        WHEN previous.score IS NULL THEN NULL
                        ELSE current.score - previous.score
                    END AS score_change,
                    CASE
                        WHEN previous.power IS NULL THEN NULL
                        ELSE current.power - previous.power
                    END AS power_change
                FROM arena_ranking_entries current
                LEFT JOIN arena_ranking_entries previous
                  ON previous.snapshot_id = ?
                 AND previous.player_uid = current.player_uid
                WHERE current.snapshot_id = ?
                {server_clause}
                ORDER BY current.arena_rank
                LIMIT ?
                """,
                (previous_id, *params),
            ).fetchall()
            servers = connection.execute(
                """
                SELECT
                    server_id,
                    COUNT(*) AS player_count,
                    SUM(CASE WHEN arena_rank <= 10 THEN 1 ELSE 0 END) AS top10_count,
                    AVG(power) AS average_power,
                    MAX(power) AS max_power
                FROM arena_ranking_entries
                WHERE snapshot_id = ?
                GROUP BY server_id
                ORDER BY server_id
                """,
                (snapshot["snapshot_id"],),
            ).fetchall()
            alliances = connection.execute(
                """
                SELECT
                    alliance_code,
                    alliance_name,
                    server_id,
                    COUNT(*) AS player_count,
                    MIN(arena_rank) AS best_rank,
                    AVG(power) AS average_power
                FROM arena_ranking_entries
                WHERE snapshot_id = ?
                  AND COALESCE(alliance_code, '') <> ''
                GROUP BY alliance_code, alliance_name, server_id
                ORDER BY player_count DESC, best_rank
                LIMIT 20
                """,
                (snapshot["snapshot_id"],),
            ).fetchall()
        return {
            "match": dict(match),
            "snapshot": dict(snapshot),
            "entries": rows_list(entries),
            "servers": rows_list(servers),
            "alliances": rows_list(alliances),
        }

    @app.get("/api/rankings")
    def rankings(
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
        server_id: int | None = Query(default=None),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        limit = min(limit, rt.activity_config.max_rows)
        with rt.open_db() as connection:
            player_snapshot = connection.execute(
                """
                SELECT *
                FROM player_ranking_snapshots
                ORDER BY snapshot_id DESC
                LIMIT 1
                """
            ).fetchone()
            alliance_snapshot = connection.execute(
                """
                SELECT *
                FROM ranking_snapshots
                ORDER BY snapshot_id DESC
                LIMIT 1
                """
            ).fetchone()
            players: list[sqlite3.Row] = []
            alliances: list[sqlite3.Row] = []
            if player_snapshot:
                parameters: list[Any] = [player_snapshot["snapshot_id"]]
                clause = ""
                if server_id is not None:
                    clause = " AND server_id = ?"
                    parameters.append(server_id)
                parameters.append(limit)
                players = connection.execute(
                    f"""
                    SELECT
                        cross_server_rank,
                        server_id,
                        player_uid,
                        player_name,
                        alliance_code,
                        alliance_name,
                        power,
                        hq_level,
                        country
                    FROM player_ranking_entries
                    WHERE snapshot_id = ? {clause}
                    ORDER BY cross_server_rank
                    LIMIT ?
                    """,
                    parameters,
                ).fetchall()
            if alliance_snapshot:
                parameters = [alliance_snapshot["snapshot_id"]]
                clause = ""
                if server_id is not None:
                    clause = " AND server_id = ?"
                    parameters.append(server_id)
                parameters.append(limit)
                alliances = connection.execute(
                    f"""
                    SELECT
                        server_id,
                        server_rank,
                        cross_server_rank,
                        alliance_id,
                        code,
                        full_name,
                        fight_power,
                        leader,
                        member_count,
                        max_members,
                        country
                    FROM ranking_entries
                    WHERE snapshot_id = ? {clause}
                    ORDER BY COALESCE(cross_server_rank, 999999), server_id, server_rank
                    LIMIT ?
                    """,
                    parameters,
                ).fetchall()
        return {
            "player_snapshot": row_dict(player_snapshot),
            "alliance_snapshot": row_dict(alliance_snapshot),
            "players": rows_list(players),
            "alliances": rows_list(alliances),
        }

    @app.get("/api/alliances")
    def alliances_list(
        request: Request,
        query_text: str = Query(default="", alias="query", max_length=100),
        server_id: int | None = Query(default=None),
        limit: int = Query(default=100, ge=1, le=200),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        limit = min(limit, rt.activity_config.max_rows)
        clauses = ["1=1"]
        params: list[Any] = []
        if query_text.strip():
            clauses.append("(code LIKE ? OR full_name LIKE ? OR leader LIKE ?)")
            value = f"%{query_text.strip()}%"
            params.extend([value, value, value])
        if server_id is not None:
            clauses.append("server_id = ?")
            params.append(server_id)
        params.append(limit)
        with rt.open_db() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    a.*,
                    (
                        SELECT MAX(ms.captured_at)
                        FROM member_snapshots ms
                        WHERE ms.alliance_id = a.alliance_id
                    ) AS latest_member_snapshot,
                    (
                        SELECT ms2.presence_redacted
                        FROM member_snapshots ms2
                        WHERE ms2.alliance_id = a.alliance_id
                        ORDER BY ms2.snapshot_id DESC
                        LIMIT 1
                    ) AS presence_redacted,
                    CASE WHEN ta.enabled = 1 THEN 1 ELSE 0 END AS tracked
                FROM alliances a
                LEFT JOIN tracked_alliances ta
                  ON ta.alliance_id = a.alliance_id
                WHERE {' AND '.join(clauses)}
                ORDER BY a.server_id, a.latest_fight_power DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return {"alliances": rows_list(rows)}

    @app.get("/api/alliance/{code}")
    def alliance_detail(
        code: str,
        request: Request,
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        with rt.open_db() as connection:
            alliance = connection.execute(
                """
                SELECT a.*, CASE WHEN ta.enabled = 1 THEN 1 ELSE 0 END AS tracked
                FROM alliances a
                LEFT JOIN tracked_alliances ta
                  ON ta.alliance_id = a.alliance_id
                WHERE UPPER(a.code) = UPPER(?)
                ORDER BY a.updated_at DESC
                LIMIT 1
                """,
                (code,),
            ).fetchone()
            if not alliance:
                raise HTTPException(status_code=404, detail="Alliance not found.")
            latest = connection.execute(
                """
                SELECT *
                FROM member_snapshots
                WHERE alliance_id = ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (alliance["alliance_id"],),
            ).fetchone()
            if not latest:
                return {"alliance": dict(alliance), "snapshot": None, "members": []}
            previous = connection.execute(
                """
                SELECT snapshot_id
                FROM member_snapshots
                WHERE alliance_id = ? AND snapshot_id < ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (alliance["alliance_id"], latest["snapshot_id"]),
            ).fetchone()
            previous_id = previous[0] if previous else -1
            members = connection.execute(
                """
                SELECT
                    current.player_uid,
                    current.player_name,
                    current.server_id,
                    current.power,
                    current.hq_level,
                    current.alliance_rank,
                    current.rank_name,
                    current.online,
                    current.offline_time_ms,
                    current.army_kill,
                    current.month_card_expiry_s,
                    previous.power AS previous_power,
                    previous.hq_level AS previous_hq,
                    previous.army_kill AS previous_kills,
                    CASE WHEN previous.power IS NULL THEN NULL
                         ELSE current.power - previous.power END AS power_change,
                    CASE WHEN previous.hq_level IS NULL THEN NULL
                         ELSE current.hq_level - previous.hq_level END AS hq_change,
                    CASE WHEN previous.army_kill IS NULL THEN NULL
                         ELSE current.army_kill - previous.army_kill END AS kill_change
                FROM member_entries current
                LEFT JOIN member_entries previous
                  ON previous.snapshot_id = ?
                 AND previous.player_uid = current.player_uid
                WHERE current.snapshot_id = ?
                ORDER BY current.power DESC
                """,
                (previous_id, latest["snapshot_id"]),
            ).fetchall()
            history = connection.execute(
                """
                SELECT
                    ms.captured_at,
                    ms.member_count,
                    SUM(me.power) AS total_power,
                    AVG(me.power) AS average_power,
                    SUM(CASE WHEN me.online = 1 THEN 1 ELSE 0 END) AS online_observed
                FROM member_snapshots ms
                JOIN member_entries me ON me.snapshot_id = ms.snapshot_id
                WHERE ms.alliance_id = ?
                GROUP BY ms.snapshot_id
                ORDER BY ms.snapshot_id DESC
                LIMIT 20
                """,
                (alliance["alliance_id"],),
            ).fetchall()
        return {
            "alliance": dict(alliance),
            "snapshot": dict(latest),
            "members": rows_list(members),
            "history": rows_list(history),
        }

    @app.get("/api/players")
    def players_search(
        request: Request,
        query_text: str = Query(default="", alias="query", max_length=100),
        limit: int = Query(default=50, ge=1, le=200),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        limit = min(limit, rt.activity_config.max_rows)
        text = query_text.strip()
        with rt.open_db() as connection:
            rows = connection.execute(
                """
                WITH latest_profile AS (
                    SELECT pp.*
                    FROM player_profile_snapshots pp
                    JOIN (
                        SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                        FROM player_profile_snapshots
                        GROUP BY player_uid
                    ) x ON x.snapshot_id = pp.snapshot_id
                ),
                latest_public AS (
                    SELECT pi.*
                    FROM player_public_info_snapshots pi
                    JOIN (
                        SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                        FROM player_public_info_snapshots
                        GROUP BY player_uid
                    ) x ON x.snapshot_id = pi.snapshot_id
                ),
                latest_member AS (
                    SELECT me.*
                    FROM member_entries me
                    JOIN (
                        SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                        FROM member_entries
                        GROUP BY player_uid
                    ) x ON x.player_uid = me.player_uid
                       AND x.snapshot_id = me.snapshot_id
                ),
                latest_rank AS (
                    SELECT pre.*
                    FROM player_ranking_entries pre
                    JOIN (
                        SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                        FROM player_ranking_entries
                        GROUP BY player_uid
                    ) x ON x.player_uid = pre.player_uid
                       AND x.snapshot_id = pre.snapshot_id
                )
                SELECT
                    p.player_uid,
                    COALESCE(lp.player_name, lpub.player_name, lm.player_name,
                             lr.player_name, p.player_name) AS player_name,
                    COALESCE(lp.server_id, lpub.server_id, lm.server_id,
                             lr.server_id, p.server_id) AS server_id,
                    COALESCE(lp.current_power, lpub.power, lm.power, lr.power) AS power,
                    COALESCE(lp.base_level, lpub.main_building_level,
                             lm.hq_level, lr.hq_level) AS hq_level,
                    COALESCE(lp.alliance_code, lpub.alliance_code,
                             lr.alliance_code) AS alliance_code,
                    lp.snapshot_id AS profile_snapshot_id,
                    lr.cross_server_rank
                FROM players p
                LEFT JOIN latest_profile lp ON lp.player_uid = p.player_uid
                LEFT JOIN latest_public lpub ON lpub.player_uid = p.player_uid
                LEFT JOIN latest_member lm ON lm.player_uid = p.player_uid
                LEFT JOIN latest_rank lr ON lr.player_uid = p.player_uid
                WHERE (? = '')
                   OR COALESCE(lp.player_name, lpub.player_name, lm.player_name,
                               lr.player_name, p.player_name, '') LIKE ?
                   OR p.player_uid LIKE ?
                ORDER BY COALESCE(lp.current_power, lpub.power, lm.power,
                                  lr.power, 0) DESC
                LIMIT ?
                """,
                (text, f"%{text}%", f"%{text}%", limit),
            ).fetchall()
        return {"players": rows_list(rows)}

    @app.get("/api/player/{player_uid}")
    def player_detail(
        player_uid: str,
        request: Request,
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        with rt.open_db() as connection:
            player = connection.execute(
                "SELECT * FROM players WHERE player_uid = ?",
                (player_uid,),
            ).fetchone()
            if not player:
                raise HTTPException(status_code=404, detail="Player not found.")
            profile = connection.execute(
                """
                SELECT *
                FROM player_profile_snapshots
                WHERE player_uid = ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (player_uid,),
            ).fetchone()
            public = connection.execute(
                """
                SELECT *
                FROM player_public_info_snapshots
                WHERE player_uid = ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (player_uid,),
            ).fetchone()
            ranking_history = connection.execute(
                """
                SELECT
                    prs.captured_at,
                    pre.cross_server_rank,
                    pre.power,
                    pre.hq_level,
                    pre.server_id,
                    pre.alliance_code
                FROM player_ranking_entries pre
                JOIN player_ranking_snapshots prs
                  ON prs.snapshot_id = pre.snapshot_id
                WHERE pre.player_uid = ?
                ORDER BY prs.snapshot_id DESC
                LIMIT 20
                """,
                (player_uid,),
            ).fetchall()
            member_history = connection.execute(
                """
                SELECT
                    ms.captured_at,
                    me.power,
                    me.hq_level,
                    me.army_kill,
                    a.code AS alliance_code
                FROM member_entries me
                JOIN member_snapshots ms ON ms.snapshot_id = me.snapshot_id
                LEFT JOIN alliances a ON a.alliance_id = me.alliance_id
                WHERE me.player_uid = ?
                ORDER BY ms.snapshot_id DESC
                LIMIT 20
                """,
                (player_uid,),
            ).fetchall()
        return {
            "player": dict(player),
            "profile": row_dict(profile),
            "public": row_dict(public),
            "ranking_history": rows_list(ranking_history),
            "member_history": rows_list(member_history),
        }

    @app.get("/api/changes")
    def changes(
        request: Request,
        limit: int = Query(default=100, ge=1, le=500),
        event_type: str | None = Query(default=None),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        clauses = ["1=1"]
        params: list[Any] = []
        if event_type:
            clauses.append("mce.event_type = ?")
            params.append(event_type)
        params.append(min(limit, 500))
        with rt.open_db() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    mce.*,
                    a.code AS alliance_code,
                    a.server_id AS alliance_server
                FROM member_change_events mce
                LEFT JOIN alliances a ON a.alliance_id = mce.alliance_id
                WHERE {' AND '.join(clauses)}
                ORDER BY mce.event_id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return {"changes": rows_list(rows)}

    @app.get("/api/refresh/jobs")
    def refresh_jobs(
        request: Request,
        limit: int = Query(default=50, ge=1, le=200),
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        with rt.open_db() as connection:
            jobs = connection.execute(
                """
                SELECT *
                FROM refresh_jobs
                ORDER BY job_id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            job_ids = [row["job_id"] for row in jobs]
            steps_by_job: dict[int, list[dict[str, Any]]] = {
                int(job_id): [] for job_id in job_ids
            }
            if job_ids:
                placeholders = ",".join("?" for _ in job_ids)
                steps = connection.execute(
                    f"""
                    SELECT *
                    FROM refresh_job_steps
                    WHERE job_id IN ({placeholders})
                    ORDER BY job_id DESC, step_order
                    """,
                    job_ids,
                ).fetchall()
                for step in steps:
                    steps_by_job[int(step["job_id"])].append(dict(step))
        payload = []
        for job in jobs:
            item = dict(job)
            item["steps"] = steps_by_job.get(int(job["job_id"]), [])
            payload.append(item)
        return {"jobs": payload, "freshness": freshness_payload(rt)}

    @app.post("/api/refresh/queue")
    def refresh_queue(
        payload: RefreshRequest,
        request: Request,
        identity: Identity = Depends(admin_identity),
    ) -> dict[str, Any]:
        rt: ActivityRuntime = request.app.state.runtime
        allowed = {
            "arena",
            "rankings",
            "my_alliance",
            "tracked_alliances",
            "full_weekly",
        }
        if payload.job_type not in allowed:
            raise HTTPException(status_code=400, detail="Unknown refresh job type.")
        job_id = queue_job(
            rt.database_path,
            payload.job_type,
            config=rt.config,
            trigger_type="manual",
            priority=50,
            idle_required=payload.idle_required,
            details={
                "requested_by_discord_user_id": identity.user_id,
                "requested_by": identity.global_name or identity.username,
            },
        )
        return {"job_id": job_id, "status": "queued"}

    @app.post("/api/refresh/jobs/{job_id}/cancel")
    def refresh_cancel(
        job_id: int,
        request: Request,
        identity: Identity = Depends(admin_identity),
    ) -> dict[str, Any]:
        del identity
        rt: ActivityRuntime = request.app.state.runtime
        cancelled = cancel_job(rt.database_path, job_id)
        if not cancelled:
            raise HTTPException(
                status_code=409,
                detail="The job is not cancellable or does not exist.",
            )
        return {"job_id": job_id, "status": "cancelled"}

    @app.get("/api/export/status.json")
    def export_status(
        request: Request,
        identity: Identity = Depends(current_identity),
    ) -> dict[str, Any]:
        del identity
        return overview(request, Identity("", "", None, None, False, True))

    if runtime.static_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=runtime.static_dir, html=True),
            name="activity-static",
        )
    else:
        @app.get("/")
        def missing_frontend():
            index = runtime.root / "activity" / "client" / "index.html"
            if index.is_file():
                return FileResponse(index)
            return JSONResponse(
                status_code=503,
                content={
                    "detail": (
                        "Discord Activity frontend is not built. "
                        "Run setup_discord_activity.bat."
                    )
                },
            )

    return app


CONFIG_PATH = os.environ.get("DARKWAR_CONFIG", "config.toml")
app = create_app(CONFIG_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Serve the DarkWar Discord Activity and API."
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    import uvicorn

    config_path = Path(args.config).resolve()
    config = load_config(config_path)
    os.environ["DARKWAR_CONFIG"] = str(config_path)
    host = args.host or config.discord_activity.host
    port = args.port or config.discord_activity.port
    uvicorn.run(
        "darkwar_tracker.activity_api:app",
        host=host,
        port=port,
        reload=False,
        env_file=None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
