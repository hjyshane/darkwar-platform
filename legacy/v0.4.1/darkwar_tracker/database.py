from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _json_default(value: Any) -> Any:
    """Convert non-JSON SmartFox values into lossless JSON-safe objects."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return {
            "__darkwar_type__": "bytes",
            "length": len(raw),
            "hex": raw.hex(),
        }

    if isinstance(value, set):
        return sorted(value, key=repr)

    raise TypeError(
        f"Object of type {type(value).__name__} is not JSON serializable"
    )


def safe_json_dumps(
    value: Any,
    *,
    compact: bool = False,
) -> str:
    """Serialize decoded SmartFox objects without failing on byte arrays."""
    options: dict[str, Any] = {
        "ensure_ascii": False,
        "default": _json_default,
    }
    if compact:
        options["separators"] = (",", ":")

    return json.dumps(value, **options)


class Database:
    def __init__(self, path: str | Path, top_n: int = 3):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.top_n = top_n
        self._lock = threading.RLock()
        self.connection = sqlite3.connect(
            self.path,
            check_same_thread=False,
            timeout=30,
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=30000")
        self.create_schema()

    def close(self) -> None:
        with self._lock:
            self.connection.close()

    def create_schema(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS alliances (
            alliance_id TEXT PRIMARY KEY,
            server_id INTEGER,
            code TEXT,
            full_name TEXT,
            leader TEXT,
            country TEXT,
            max_members INTEGER,
            latest_member_count INTEGER,
            latest_fight_power INTEGER,
            gift_level INTEGER,
            minimum_hq INTEGER,
            minimum_power INTEGER,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS players (
            player_uid TEXT PRIMARY KEY,
            player_name TEXT,
            server_id INTEGER,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ranking_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            range_type INTEGER,
            is_merge INTEGER,
            source_request_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS ranking_entries (
            snapshot_id INTEGER NOT NULL,
            alliance_id TEXT NOT NULL,
            server_id INTEGER,
            server_rank INTEGER,
            cross_server_rank INTEGER,
            code TEXT,
            full_name TEXT,
            fight_power INTEGER,
            leader TEXT,
            member_count INTEGER,
            max_members INTEGER,
            country TEXT,
            PRIMARY KEY (snapshot_id, alliance_id),
            FOREIGN KEY (snapshot_id)
                REFERENCES ranking_snapshots(snapshot_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tracked_alliances (
            alliance_id TEXT PRIMARY KEY,
            server_id INTEGER NOT NULL,
            server_rank INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alliance_info_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            alliance_id TEXT NOT NULL,
            fight_power INTEGER,
            member_count INTEGER,
            max_members INTEGER,
            gift_level INTEGER,
            minimum_hq INTEGER,
            minimum_power INTEGER,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS member_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            alliance_id TEXT NOT NULL,
            member_count INTEGER NOT NULL,
            presence_redacted INTEGER NOT NULL,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS member_entries (
            snapshot_id INTEGER NOT NULL,
            alliance_id TEXT NOT NULL,
            player_uid TEXT NOT NULL,
            player_name TEXT,
            server_id INTEGER,
            current_server_id INTEGER,
            power INTEGER,
            hq_level INTEGER,
            alliance_rank INTEGER,
            rank_name TEXT,
            online INTEGER,
            offline_time_ms INTEGER,
            point_id TEXT,
            army_kill INTEGER,
            career_type INTEGER,
            career_level INTEGER,
            career_position INTEGER,
            sex INTEGER,
            profile_picture TEXT,
            profile_picture_version INTEGER,
            head_skin_id INTEGER,
            head_skin_expiry_ms INTEGER,
            month_card_expiry_s INTEGER,
            alliance_sign TEXT,
            PRIMARY KEY (snapshot_id, player_uid),
            FOREIGN KEY (snapshot_id)
                REFERENCES member_snapshots(snapshot_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS member_change_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            detected_at TEXT NOT NULL,
            alliance_id TEXT NOT NULL,
            player_uid TEXT NOT NULL,
            player_name TEXT,
            event_type TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            numeric_delta INTEGER,
            from_snapshot_id INTEGER,
            to_snapshot_id INTEGER NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (from_snapshot_id)
                REFERENCES member_snapshots(snapshot_id) ON DELETE SET NULL,
            FOREIGN KEY (to_snapshot_id)
                REFERENCES member_snapshots(snapshot_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS player_ranking_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            range_type INTEGER,
            is_merge INTEGER,
            source_request_id INTEGER,
            self_power INTEGER,
            self_ranking INTEGER,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_ranking_entries (
            snapshot_id INTEGER NOT NULL,
            player_uid TEXT NOT NULL,
            cross_server_rank INTEGER,
            server_id INTEGER,
            player_name TEXT,
            alliance_code TEXT,
            alliance_name TEXT,
            power INTEGER,
            hq_level INTEGER,
            month_card_expiry_s INTEGER,
            country TEXT,
            profile_picture TEXT,
            profile_picture_version INTEGER,
            head_skin_id INTEGER,
            head_skin_expiry_ms INTEGER,
            PRIMARY KEY (snapshot_id, player_uid),
            FOREIGN KEY (snapshot_id)
                REFERENCES player_ranking_snapshots(snapshot_id)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS player_profile_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            player_uid TEXT NOT NULL,
            player_name TEXT,
            server_id INTEGER,
            alliance_id TEXT,
            alliance_code TEXT,
            alliance_name TEXT,
            current_power INTEGER,
            reported_max_power INTEGER,
            building_power INTEGER,
            science_power INTEGER,
            hero_power INTEGER,
            army_power INTEGER,
            vehicle_power INTEGER,
            pet_power INTEGER,
            base_level INTEGER,
            army_kill INTEGER,
            army_dead INTEGER,
            battle_win INTEGER,
            battle_lose INTEGER,
            scout_count INTEGER,
            month_card_expiry_s INTEGER,
            registration_time_ms INTEGER,
            likes INTEGER,
            country_flag TEXT,
            position_id TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_public_info_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            player_uid TEXT NOT NULL,
            player_name TEXT,
            server_id INTEGER,
            current_server INTEGER,
            score_server INTEGER,
            alliance_id TEXT,
            alliance_code TEXT,
            alliance_name TEXT,
            power INTEGER,
            main_building_level INTEGER,
            army_kill INTEGER,
            vip_level INTEGER,
            vip_end_time_s INTEGER,
            svip_level INTEGER,
            max_hero_id INTEGER,
            max_power INTEGER,
            migrate_power INTEGER,
            month_card_expiry_s INTEGER,
            last_update_time_s INTEGER,
            country TEXT,
            country_flag TEXT,
            language TEXT,
            position_id TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS arena_matches (
            match_id INTEGER PRIMARY KEY AUTOINCREMENT,
            base_server INTEGER NOT NULL,
            fight_servers TEXT NOT NULL,
            opponent_servers TEXT NOT NULL,
            start_time_ms INTEGER NOT NULL,
            end_time_ms INTEGER NOT NULL,
            arena_type INTEGER,
            user_arena_type INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            UNIQUE (
                base_server,
                fight_servers,
                start_time_ms,
                end_time_ms,
                user_arena_type
            )
        );

        CREATE TABLE IF NOT EXISTS arena_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            captured_at TEXT NOT NULL,
            source_request_id INTEGER,
            own_defense_power INTEGER,
            alliance_top_rank INTEGER,
            daily_refresh_times INTEGER,
            buy_time INTEGER,
            stop_reason INTEGER,
            fight_time_ms INTEGER,
            storm_lowest_rank INTEGER,
            self_arena_type INTEGER,
            player_count INTEGER NOT NULL,
            raw_json TEXT NOT NULL,
            FOREIGN KEY (match_id)
                REFERENCES arena_matches(match_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS arena_ranking_entries (
            snapshot_id INTEGER NOT NULL,
            match_id INTEGER NOT NULL,
            player_uid TEXT NOT NULL,
            arena_rank INTEGER,
            score INTEGER,
            power INTEGER,
            server_id INTEGER,
            current_server_id INTEGER,
            player_name TEXT,
            alliance_code TEXT,
            alliance_name TEXT,
            country TEXT,
            main_build_point INTEGER,
            career_type INTEGER,
            career_level INTEGER,
            sex INTEGER,
            profile_picture TEXT,
            profile_picture_version INTEGER,
            head_skin_id INTEGER,
            head_skin_expiry_ms INTEGER,
            head_frame INTEGER,
            ban_type INTEGER,
            army_blob TEXT,
            PRIMARY KEY (snapshot_id, player_uid),
            FOREIGN KEY (snapshot_id)
                REFERENCES arena_snapshots(snapshot_id) ON DELETE CASCADE,
            FOREIGN KEY (match_id)
                REFERENCES arena_matches(match_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS arena_defense_snapshots (
            defense_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            direction TEXT NOT NULL,
            source_request_id INTEGER,
            army_id TEXT,
            requested_power INTEGER,
            confirmed_power INTEGER,
            heroes_json TEXT,
            army_blob TEXT,
            raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS refresh_jobs (
            job_id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_type TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            week_key TEXT,
            requested_at TEXT NOT NULL,
            scheduled_for TEXT NOT NULL,
            not_before TEXT NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 100,
            idle_required INTEGER NOT NULL DEFAULT 1,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            current_step TEXT,
            started_at TEXT,
            finished_at TEXT,
            last_activity_at TEXT NOT NULL,
            last_error TEXT,
            details_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS refresh_job_steps (
            step_id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            workflow_id TEXT NOT NULL,
            step_order INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            started_at TEXT,
            finished_at TEXT,
            last_error TEXT,
            details_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE (job_id, workflow_id),
            FOREIGN KEY (job_id)
                REFERENCES refresh_jobs(job_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS capture_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            direction TEXT NOT NULL,
            command TEXT NOT NULL,
            request_id INTEGER,
            raw_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ranking_server
            ON ranking_entries(snapshot_id, server_id, server_rank);
        CREATE INDEX IF NOT EXISTS idx_member_alliance
            ON member_snapshots(alliance_id, captured_at);
        CREATE INDEX IF NOT EXISTS idx_member_player
            ON member_entries(player_uid, player_name);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_member_change_snapshot_player_type
            ON member_change_events(to_snapshot_id, player_uid, event_type);
        CREATE INDEX IF NOT EXISTS idx_member_change_alliance
            ON member_change_events(alliance_id, detected_at, event_type);
        CREATE INDEX IF NOT EXISTS idx_member_change_player
            ON member_change_events(player_uid, detected_at);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_player_ranking_capture
            ON player_ranking_snapshots(captured_at, source_request_id);
        CREATE INDEX IF NOT EXISTS idx_player_ranking_uid
            ON player_ranking_entries(player_uid, snapshot_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_player_profile_capture
            ON player_profile_snapshots(player_uid, captured_at);
        CREATE INDEX IF NOT EXISTS idx_player_profile_uid
            ON player_profile_snapshots(player_uid, snapshot_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_player_public_capture
            ON player_public_info_snapshots(player_uid, captured_at);
        CREATE INDEX IF NOT EXISTS idx_player_public_uid
            ON player_public_info_snapshots(player_uid, snapshot_id);
        CREATE INDEX IF NOT EXISTS idx_arena_match_period
            ON arena_matches(base_server, start_time_ms, end_time_ms);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_snapshot_capture
            ON arena_snapshots(match_id, captured_at, source_request_id);
        CREATE INDEX IF NOT EXISTS idx_arena_snapshot_match
            ON arena_snapshots(match_id, captured_at);
        CREATE INDEX IF NOT EXISTS idx_arena_rank_player
            ON arena_ranking_entries(player_uid, snapshot_id);
        CREATE INDEX IF NOT EXISTS idx_arena_rank_server
            ON arena_ranking_entries(snapshot_id, server_id, arena_rank);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_arena_defense_capture
            ON arena_defense_snapshots(
                captured_at, direction, source_request_id
            );
        CREATE INDEX IF NOT EXISTS idx_arena_defense_request
            ON arena_defense_snapshots(source_request_id, captured_at);
        CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status
            ON refresh_jobs(status, priority, scheduled_for);
        CREATE INDEX IF NOT EXISTS idx_refresh_jobs_week
            ON refresh_jobs(trigger_type, week_key, job_type);
        CREATE INDEX IF NOT EXISTS idx_refresh_steps_job
            ON refresh_job_steps(job_id, step_order, status);
        CREATE INDEX IF NOT EXISTS idx_capture_command
            ON capture_events(command, captured_at);
        """
        with self._lock, self.connection:
            self.connection.executescript(schema)

    def record_event(
        self,
        direction: str,
        command: str,
        request_id: int | None,
        payload: dict[str, Any],
        captured_at: str | None = None,
    ) -> None:
        timestamp = captured_at or utc_now()
        raw_json = safe_json_dumps(payload, compact=True)

        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO capture_events
                    (captured_at, direction, command, request_id, raw_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (timestamp, direction, command, request_id, raw_json),
            )

    def handle_event(
        self,
        direction: str,
        command: str,
        payload: dict[str, Any],
        request_id: int | None,
        captured_at: str | None = None,
    ) -> str | None:
        timestamp = captured_at or utc_now()
        self.record_event(
            direction, command, request_id, payload, captured_at=timestamp
        )

        if command == "user.arena.save.defend.army":
            self.save_arena_defense_snapshot(
                direction=direction,
                payload=payload,
                request_id=request_id,
                captured_at=timestamp,
            )
            if direction == "inbound":
                return "saved arena defense formation"

        # Only inbound extension responses contain the complete data snapshots.
        if direction != "inbound":
            return None

        if command == "user.get.arena.info" and isinstance(
            payload.get("rankArr"), list
        ):
            match_id, count = self.save_arena_snapshot(payload, timestamp)
            return f"saved arena match={match_id}: {count} players"

        if command == "server.rank" and isinstance(
            payload.get("serverRanking"), list
        ):
            count = self.save_player_ranking_snapshot(payload, timestamp)
            return f"saved player ranking: {count} players"

        if command == "get.new.user.info" and payload.get("uid"):
            player_uid, player_name = self.save_player_profile_snapshot(
                payload,
                timestamp,
            )
            return f"saved player profile: {player_name or player_uid}"

        if command == "get.user.info.multi" and isinstance(
            payload.get("uids"), list
        ):
            count = self.save_player_public_info_snapshot(payload, timestamp)
            return f"saved player public info: {count} players"

        if command == "alliance.rank" and isinstance(
            payload.get("allianceRanking"), list
        ):
            count = self.save_ranking_snapshot(payload, timestamp)
            return f"saved alliance ranking: {count} alliances"

        if command == "get.al.info" and payload.get("uid"):
            code = self.save_alliance_info(payload, timestamp)
            return f"saved alliance info: [{code or '?'}]"

        if command == "al.rank" and isinstance(payload.get("list"), list):
            alliance_id, count = self.save_member_snapshot(payload, timestamp)
            code = self.get_alliance_code(alliance_id)
            return f"saved members: [{code or '?'}] {count}"

        return None

    def _upsert_player(
        self,
        *,
        player_uid: str,
        player_name: str | None,
        server_id: Any,
        captured_at: str,
    ) -> None:
        if not player_uid:
            return
        self.connection.execute(
            """
            INSERT INTO players (
                player_uid, player_name, server_id, updated_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(player_uid) DO UPDATE SET
                player_name = COALESCE(
                    excluded.player_name, players.player_name
                ),
                server_id = COALESCE(
                    excluded.server_id, players.server_id
                ),
                updated_at = excluded.updated_at
            """,
            (player_uid, player_name, server_id, captured_at),
        )

    def save_player_ranking_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> int:
        ranking = payload.get("serverRanking") or []
        request_id = payload.get("_id")

        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO player_ranking_snapshots (
                    captured_at, range_type, is_merge, source_request_id,
                    self_power, self_ranking, raw_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    captured_at,
                    payload.get("rangeType"),
                    payload.get("ismerge"),
                    request_id,
                    payload.get("selfPower"),
                    payload.get("selfRanking"),
                    safe_json_dumps(payload),
                ),
            )
            snapshot_row = self.connection.execute(
                """
                SELECT snapshot_id
                FROM player_ranking_snapshots
                WHERE captured_at = ?
                  AND source_request_id IS ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (captured_at, request_id),
            ).fetchone()
            if snapshot_row is None:
                raise RuntimeError("Failed to resolve player ranking snapshot")
            snapshot_id = int(snapshot_row["snapshot_id"])

            for item in ranking:
                player_uid = str(item.get("uid") or "")
                if not player_uid:
                    continue
                player_name = item.get("name")
                server_id = item.get("serverId")

                self._upsert_player(
                    player_uid=player_uid,
                    player_name=player_name,
                    server_id=server_id,
                    captured_at=captured_at,
                )
                self.connection.execute(
                    """
                    INSERT OR IGNORE INTO player_ranking_entries (
                        snapshot_id, player_uid, cross_server_rank,
                        server_id, player_name, alliance_code,
                        alliance_name, power, hq_level,
                        month_card_expiry_s, country,
                        profile_picture, profile_picture_version,
                        head_skin_id, head_skin_expiry_ms
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot_id,
                        player_uid,
                        item.get("rank"),
                        server_id,
                        player_name,
                        item.get("abbr"),
                        item.get("allianceName"),
                        item.get("power"),
                        item.get("lv"),
                        item.get("monthCardEndTime"),
                        item.get("country"),
                        item.get("pic"),
                        item.get("picVer"),
                        item.get("headSkinId"),
                        item.get("headSkinET"),
                    ),
                )

        return len(ranking)

    def save_player_profile_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> tuple[str, str | None]:
        player_uid = str(payload.get("uid") or "")
        if not player_uid:
            raise ValueError("get.new.user.info response is missing uid")

        player_name = payload.get("name")
        server_id = payload.get("serverId")

        with self._lock, self.connection:
            self._upsert_player(
                player_uid=player_uid,
                player_name=player_name,
                server_id=server_id,
                captured_at=captured_at,
            )
            self.connection.execute(
                """
                INSERT OR IGNORE INTO player_profile_snapshots (
                    captured_at, player_uid, player_name, server_id,
                    alliance_id, alliance_code, alliance_name,
                    current_power, reported_max_power,
                    building_power, science_power, hero_power,
                    army_power, vehicle_power, pet_power,
                    base_level, army_kill, army_dead,
                    battle_win, battle_lose, scout_count,
                    month_card_expiry_s, registration_time_ms,
                    likes, country_flag, position_id, raw_json
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    captured_at,
                    player_uid,
                    player_name,
                    server_id,
                    payload.get("allianceId"),
                    payload.get("abbr"),
                    payload.get("allianceName"),
                    payload.get("power"),
                    payload.get("playerMaxPower"),
                    payload.get("buildingPower"),
                    payload.get("sciencePower"),
                    payload.get("heroPower"),
                    payload.get("armyPower"),
                    payload.get("modCarPower"),
                    payload.get("petPower"),
                    payload.get("baseLevel"),
                    payload.get("armyKill"),
                    payload.get("armyDead"),
                    payload.get("battleWin"),
                    payload.get("battleLose"),
                    payload.get("scoutCount"),
                    payload.get("monthCardEndTime"),
                    payload.get("regTime"),
                    payload.get("likecount"),
                    payload.get("countryflag"),
                    (
                        str(payload.get("positionId"))
                        if payload.get("positionId") is not None
                        else None
                    ),
                    safe_json_dumps(payload),
                ),
            )

        return player_uid, str(player_name) if player_name is not None else None

    def save_player_public_info_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> int:
        users = payload.get("uids") or []
        saved = 0

        with self._lock, self.connection:
            for item in users:
                if not isinstance(item, dict):
                    continue
                player_uid = str(item.get("uid") or "")
                if not player_uid:
                    continue

                player_name = item.get("name")
                server_id = item.get("serverId") or item.get("server")
                self._upsert_player(
                    player_uid=player_uid,
                    player_name=player_name,
                    server_id=server_id,
                    captured_at=captured_at,
                )
                before = self.connection.total_changes
                self.connection.execute(
                    """
                    INSERT OR IGNORE INTO player_public_info_snapshots (
                        captured_at, player_uid, player_name, server_id,
                        current_server, score_server, alliance_id,
                        alliance_code, alliance_name, power,
                        main_building_level, army_kill, vip_level,
                        vip_end_time_s, svip_level, max_hero_id,
                        max_power, migrate_power, month_card_expiry_s,
                        last_update_time_s, country, country_flag,
                        language, position_id, raw_json
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    (
                        captured_at,
                        player_uid,
                        player_name,
                        server_id,
                        item.get("currentServer"),
                        item.get("scoreServer"),
                        item.get("allianceId"),
                        item.get("allianceAbbrName"),
                        item.get("allianceName"),
                        item.get("power"),
                        item.get("mainBuildingLevel"),
                        item.get("armyKill"),
                        item.get("vipLevel"),
                        item.get("vipEndTime"),
                        item.get("svipLevel"),
                        item.get("maxHeroId"),
                        item.get("maxPower"),
                        item.get("migratePower"),
                        item.get("monthCardEndTime"),
                        item.get("lastUpdateTime"),
                        item.get("country"),
                        item.get("countryflag"),
                        item.get("lang"),
                        (
                            str(item.get("positionId"))
                            if item.get("positionId") is not None
                            else None
                        ),
                        safe_json_dumps(item),
                    ),
                )
                if self.connection.total_changes > before:
                    saved += 1

        return saved

    def backfill_player_profile_events(self) -> int:
        """Build profile/ranking tables from already captured raw events."""
        added = 0
        rows = self.connection.execute(
            """
            SELECT captured_at, command, raw_json
            FROM capture_events
            WHERE direction = 'inbound'
              AND command IN (
                  'server.rank',
                  'get.new.user.info',
                  'get.user.info.multi'
              )
            ORDER BY event_id
            """
        ).fetchall()

        for row in rows:
            try:
                payload = json.loads(str(row["raw_json"]))
            except (TypeError, json.JSONDecodeError):
                continue

            before = self.connection.total_changes
            command = str(row["command"])
            captured_at = str(row["captured_at"])

            if command == "server.rank" and isinstance(
                payload.get("serverRanking"), list
            ):
                self.save_player_ranking_snapshot(payload, captured_at)
            elif command == "get.new.user.info" and payload.get("uid"):
                self.save_player_profile_snapshot(payload, captured_at)
            elif command == "get.user.info.multi" and isinstance(
                payload.get("uids"), list
            ):
                self.save_player_public_info_snapshot(payload, captured_at)

            added += self.connection.total_changes - before

        return added

    @staticmethod
    def _arena_server_list(value: Any) -> list[int]:
        servers: list[int] = []
        for part in str(value or "").replace(",", ";").split(";"):
            part = part.strip()
            if not part:
                continue
            try:
                server_id = int(part)
            except ValueError:
                continue
            if server_id not in servers:
                servers.append(server_id)
        return sorted(servers)

    def save_arena_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> tuple[int, int]:
        ranking = payload.get("rankArr") or []
        fight_servers = self._arena_server_list(payload.get("fightServers"))
        if not fight_servers:
            fight_servers = sorted({
                int(item.get("serverId"))
                for item in ranking
                if item.get("serverId") is not None
            })
        base_server = 580 if 580 in fight_servers else (
            fight_servers[0] if fight_servers else 0
        )
        canonical_servers = ";".join(str(value) for value in fight_servers)
        opponents = ";".join(
            str(value) for value in fight_servers if value != base_server
        )
        start_time_ms = int(payload.get("startTime") or 0)
        end_time_ms = int(payload.get("endTime") or 0)
        user_arena_type = payload.get("userArenaType")

        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO arena_matches (
                    base_server, fight_servers, opponent_servers,
                    start_time_ms, end_time_ms, arena_type,
                    user_arena_type, status, first_seen_at, last_seen_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                ON CONFLICT (
                    base_server, fight_servers, start_time_ms,
                    end_time_ms, user_arena_type
                ) DO UPDATE SET
                    arena_type = excluded.arena_type,
                    status = 'active',
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    base_server,
                    canonical_servers,
                    opponents,
                    start_time_ms,
                    end_time_ms,
                    payload.get("arenaType"),
                    user_arena_type,
                    captured_at,
                    captured_at,
                ),
            )
            match_row = self.connection.execute(
                """
                SELECT match_id
                FROM arena_matches
                WHERE base_server = ?
                  AND fight_servers = ?
                  AND start_time_ms = ?
                  AND end_time_ms = ?
                  AND user_arena_type IS ?
                """,
                (
                    base_server,
                    canonical_servers,
                    start_time_ms,
                    end_time_ms,
                    user_arena_type,
                ),
            ).fetchone()
            if match_row is None:
                raise RuntimeError("Unable to resolve arena match")
            match_id = int(match_row["match_id"])

            self.connection.execute(
                """
                UPDATE arena_matches
                SET status = 'closed'
                WHERE base_server = ?
                  AND match_id <> ?
                  AND status = 'active'
                """,
                (base_server, match_id),
            )

            self.connection.execute(
                """
                INSERT OR IGNORE INTO arena_snapshots (
                    match_id, captured_at, source_request_id,
                    own_defense_power, alliance_top_rank,
                    daily_refresh_times, buy_time, stop_reason,
                    fight_time_ms, storm_lowest_rank,
                    self_arena_type, player_count, raw_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    match_id,
                    captured_at,
                    payload.get("_id"),
                    payload.get("power"),
                    payload.get("allianceTopRank"),
                    payload.get("dailyRefreshTimes"),
                    payload.get("buyTime"),
                    payload.get("stopReason"),
                    payload.get("fightTime"),
                    payload.get("stormLowestRank"),
                    payload.get("selfArenaType"),
                    len(ranking),
                    safe_json_dumps(payload),
                ),
            )
            snapshot_row = self.connection.execute(
                """
                SELECT snapshot_id
                FROM arena_snapshots
                WHERE match_id = ?
                  AND captured_at = ?
                  AND source_request_id IS ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (match_id, captured_at, payload.get("_id")),
            ).fetchone()
            if snapshot_row is None:
                raise RuntimeError("Unable to resolve arena snapshot")
            snapshot_id = int(snapshot_row["snapshot_id"])

            for item in ranking:
                player_uid = str(item.get("uid") or "")
                if not player_uid:
                    continue
                self._upsert_player(
                    player_uid=player_uid,
                    player_name=item.get("name"),
                    server_id=item.get("serverId"),
                    captured_at=captured_at,
                )
                self.connection.execute(
                    """
                    INSERT OR IGNORE INTO arena_ranking_entries (
                        snapshot_id, match_id, player_uid, arena_rank,
                        score, power, server_id, current_server_id,
                        player_name, alliance_code, alliance_name,
                        country, main_build_point, career_type,
                        career_level, sex, profile_picture,
                        profile_picture_version, head_skin_id,
                        head_skin_expiry_ms, head_frame, ban_type,
                        army_blob
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    (
                        snapshot_id,
                        match_id,
                        player_uid,
                        item.get("rank"),
                        item.get("score"),
                        item.get("power"),
                        item.get("serverId"),
                        item.get("nowServer"),
                        item.get("name"),
                        item.get("abbr"),
                        item.get("alName"),
                        item.get("country"),
                        item.get("mainBuildPoint"),
                        item.get("careerType"),
                        item.get("careerLevel"),
                        item.get("sex"),
                        item.get("pic"),
                        item.get("picver"),
                        item.get("headSkinId"),
                        item.get("headSkinET"),
                        item.get("headFrame"),
                        item.get("banType"),
                        item.get("army"),
                    ),
                )

        return match_id, len(ranking)

    def save_arena_defense_snapshot(
        self,
        *,
        direction: str,
        payload: dict[str, Any],
        request_id: int | None,
        captured_at: str,
    ) -> None:
        heroes = payload.get("heroes")
        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT OR IGNORE INTO arena_defense_snapshots (
                    captured_at, direction, source_request_id,
                    army_id, requested_power, confirmed_power,
                    heroes_json, army_blob, raw_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    captured_at,
                    direction,
                    request_id,
                    payload.get("armyId"),
                    payload.get("power") if direction == "outbound" else None,
                    payload.get("power") if direction == "inbound" else None,
                    safe_json_dumps(heroes) if heroes is not None else None,
                    payload.get("army"),
                    safe_json_dumps(payload),
                ),
            )

    def backfill_arena_events(self) -> int:
        added = 0
        rows = self.connection.execute(
            """
            SELECT captured_at, direction, command, request_id, raw_json
            FROM capture_events
            WHERE command IN (
                'user.get.arena.info',
                'user.arena.save.defend.army'
            )
            ORDER BY event_id
            """
        ).fetchall()

        for row in rows:
            try:
                payload = json.loads(str(row["raw_json"]))
            except (TypeError, json.JSONDecodeError):
                continue
            before = self.connection.total_changes
            command = str(row["command"])
            direction = str(row["direction"])
            if (
                command == "user.get.arena.info"
                and direction == "inbound"
                and isinstance(payload.get("rankArr"), list)
            ):
                self.save_arena_snapshot(payload, str(row["captured_at"]))
            elif command == "user.arena.save.defend.army":
                self.save_arena_defense_snapshot(
                    direction=direction,
                    payload=payload,
                    request_id=row["request_id"],
                    captured_at=str(row["captured_at"]),
                )
            added += self.connection.total_changes - before
        return added

    def save_ranking_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> int:
        ranking = payload.get("allianceRanking", [])
        range_type = payload.get("rangeType")
        is_merge = payload.get("ismerge")
        request_id = payload.get("_id")

        grouped: dict[int, list[dict[str, Any]]] = {}
        for item in ranking:
            server_id = int(item.get("serverId", 0) or 0)
            grouped.setdefault(server_id, []).append(item)

        server_rank_by_alliance: dict[str, int] = {}
        for server_items in grouped.values():
            ordered = sorted(
                server_items,
                key=lambda item: int(item.get("fightpower", 0) or 0),
                reverse=True,
            )
            for rank, item in enumerate(ordered, start=1):
                server_rank_by_alliance[str(item.get("uid"))] = rank

        with self._lock, self.connection:
            cursor = self.connection.execute(
                """
                INSERT INTO ranking_snapshots
                    (captured_at, range_type, is_merge, source_request_id)
                VALUES (?, ?, ?, ?)
                """,
                (captured_at, range_type, is_merge, request_id),
            )
            snapshot_id = int(cursor.lastrowid)

            for item in ranking:
                alliance_id = str(item.get("uid", ""))
                if not alliance_id:
                    continue

                server_id = int(item.get("serverId", 0) or 0)
                server_rank = server_rank_by_alliance.get(alliance_id)
                code = item.get("abbr")
                full_name = item.get("alliancename")
                fight_power = int(item.get("fightpower", 0) or 0)
                leader = item.get("leader")
                members = int(item.get("curMember", 0) or 0)
                max_members = int(item.get("maxMember", 0) or 0)
                country = item.get("country")

                self.connection.execute(
                    """
                    INSERT INTO ranking_entries (
                        snapshot_id, alliance_id, server_id, server_rank,
                        cross_server_rank, code, full_name, fight_power,
                        leader, member_count, max_members, country
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot_id,
                        alliance_id,
                        server_id,
                        server_rank,
                        item.get("rank"),
                        code,
                        full_name,
                        fight_power,
                        leader,
                        members,
                        max_members,
                        country,
                    ),
                )

                self.connection.execute(
                    """
                    INSERT INTO alliances (
                        alliance_id, server_id, code, full_name, leader,
                        country, max_members, latest_member_count,
                        latest_fight_power, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(alliance_id) DO UPDATE SET
                        server_id = excluded.server_id,
                        code = COALESCE(excluded.code, alliances.code),
                        full_name = COALESCE(
                            excluded.full_name, alliances.full_name
                        ),
                        leader = COALESCE(excluded.leader, alliances.leader),
                        country = COALESCE(excluded.country, alliances.country),
                        max_members = excluded.max_members,
                        latest_member_count = excluded.latest_member_count,
                        latest_fight_power = excluded.latest_fight_power,
                        updated_at = excluded.updated_at
                    """,
                    (
                        alliance_id,
                        server_id,
                        code,
                        full_name,
                        leader,
                        country,
                        max_members,
                        members,
                        fight_power,
                        captured_at,
                    ),
                )

            affected_servers = sorted(grouped)
            if affected_servers:
                placeholders = ",".join("?" for _ in affected_servers)
                self.connection.execute(
                    f"""
                    UPDATE tracked_alliances
                    SET enabled = 0, updated_at = ?
                    WHERE server_id IN ({placeholders})
                    """,
                    (captured_at, *affected_servers),
                )

            for alliance_id, server_rank in server_rank_by_alliance.items():
                if server_rank > self.top_n:
                    continue
                item = next(
                    row for row in ranking
                    if str(row.get("uid")) == alliance_id
                )
                self.connection.execute(
                    """
                    INSERT INTO tracked_alliances (
                        alliance_id, server_id, server_rank, enabled, updated_at
                    )
                    VALUES (?, ?, ?, 1, ?)
                    ON CONFLICT(alliance_id) DO UPDATE SET
                        server_id = excluded.server_id,
                        server_rank = excluded.server_rank,
                        enabled = 1,
                        updated_at = excluded.updated_at
                    """,
                    (
                        alliance_id,
                        int(item.get("serverId", 0) or 0),
                        server_rank,
                        captured_at,
                    ),
                )

        return len(ranking)

    def save_alliance_info(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> str | None:
        alliance_id = str(payload.get("uid", ""))
        if not alliance_id:
            return None

        code = payload.get("abbr")

        with self._lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO alliances (
                    alliance_id, server_id, code, full_name, leader,
                    country, max_members, latest_member_count,
                    latest_fight_power, gift_level, minimum_hq,
                    minimum_power, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(alliance_id) DO UPDATE SET
                    server_id = COALESCE(
                        excluded.server_id, alliances.server_id
                    ),
                    code = COALESCE(excluded.code, alliances.code),
                    full_name = COALESCE(
                        excluded.full_name, alliances.full_name
                    ),
                    leader = COALESCE(excluded.leader, alliances.leader),
                    country = COALESCE(excluded.country, alliances.country),
                    max_members = excluded.max_members,
                    latest_member_count = excluded.latest_member_count,
                    latest_fight_power = excluded.latest_fight_power,
                    gift_level = excluded.gift_level,
                    minimum_hq = excluded.minimum_hq,
                    minimum_power = excluded.minimum_power,
                    updated_at = excluded.updated_at
                """,
                (
                    alliance_id,
                    payload.get("createServer"),
                    code,
                    payload.get("name"),
                    payload.get("leaderName"),
                    payload.get("country"),
                    payload.get("maxMember"),
                    payload.get("curMember"),
                    payload.get("fightPower"),
                    payload.get("giftLevel"),
                    payload.get("castleRestrictionN"),
                    payload.get("powerRestrictionN"),
                    captured_at,
                ),
            )

            self.connection.execute(
                """
                INSERT INTO alliance_info_snapshots (
                    captured_at, alliance_id, fight_power, member_count,
                    max_members, gift_level, minimum_hq, minimum_power,
                    raw_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    captured_at,
                    alliance_id,
                    payload.get("fightPower"),
                    payload.get("curMember"),
                    payload.get("maxMember"),
                    payload.get("giftLevel"),
                    payload.get("castleRestrictionN"),
                    payload.get("powerRestrictionN"),
                    safe_json_dumps(payload),
                ),
            )

        return str(code) if code is not None else None

    def save_member_snapshot(
        self,
        payload: dict[str, Any],
        captured_at: str,
    ) -> tuple[str, int]:
        alliance_id = str(payload.get("allianceId", ""))
        members = payload.get("list") or []

        raw_rank_names = payload.get("rankName")
        rank_names: dict[str, Any] = (
            raw_rank_names if isinstance(raw_rank_names, dict) else {}
        )

        if not alliance_id:
            raise ValueError("al.rank response is missing allianceId")

        presence_redacted = bool(members) and (
            all(member.get("online") is True for member in members)
            and all(int(member.get("offLineTime", 0) or 0) == 0
                    for member in members)
            and all(str(member.get("pointId", 0) or 0) == "0"
                    for member in members)
        )

        with self._lock, self.connection:
            previous_row = self.connection.execute(
                """
                SELECT snapshot_id, captured_at
                FROM member_snapshots
                WHERE alliance_id = ?
                ORDER BY snapshot_id DESC
                LIMIT 1
                """,
                (alliance_id,),
            ).fetchone()
            previous_snapshot_id = (
                int(previous_row["snapshot_id"]) if previous_row else None
            )
            previous_captured_at = (
                str(previous_row["captured_at"]) if previous_row else None
            )

            cursor = self.connection.execute(
                """
                INSERT INTO member_snapshots (
                    captured_at, alliance_id, member_count,
                    presence_redacted, raw_json
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    captured_at,
                    alliance_id,
                    len(members),
                    int(presence_redacted),
                    safe_json_dumps(payload),
                ),
            )
            snapshot_id = int(cursor.lastrowid)

            for member in members:
                player_uid = str(
                    member.get("uid") or member.get("userId") or ""
                )
                if not player_uid:
                    continue

                player_name = member.get("name") or member.get("playerName")
                server_id = member.get("serverId")
                alliance_rank = member.get("rank")

                self.connection.execute(
                    """
                    INSERT INTO players (
                        player_uid, player_name, server_id, updated_at
                    )
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(player_uid) DO UPDATE SET
                        player_name = excluded.player_name,
                        server_id = COALESCE(
                            excluded.server_id, players.server_id
                        ),
                        updated_at = excluded.updated_at
                    """,
                    (
                        player_uid,
                        player_name,
                        server_id,
                        captured_at,
                    ),
                )

                self.connection.execute(
                    """
                    INSERT INTO member_entries (
                        snapshot_id, alliance_id, player_uid, player_name,
                        server_id, current_server_id, power, hq_level,
                        alliance_rank, rank_name, online, offline_time_ms,
                        point_id, army_kill, career_type, career_level,
                        career_position, sex, profile_picture,
                        profile_picture_version, head_skin_id,
                        head_skin_expiry_ms, month_card_expiry_s,
                        alliance_sign
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?
                    )
                    """,
                    (
                        snapshot_id,
                        alliance_id,
                        player_uid,
                        player_name,
                        server_id,
                        member.get("curServerId"),
                        member.get("power"),
                        member.get("mainCityLv"),
                        alliance_rank,
                        rank_names.get(str(alliance_rank)),
                        (
                            None if member.get("online") is None
                            else int(bool(member.get("online")))
                        ),
                        member.get("offLineTime"),
                        str(member.get("pointId"))
                        if member.get("pointId") is not None else None,
                        member.get("armyKill"),
                        member.get("careerType"),
                        member.get("careerLv"),
                        member.get("careerPos"),
                        member.get("sex"),
                        member.get("pic"),
                        member.get("picVer"),
                        member.get("headSkinId"),
                        member.get("headSkinET"),
                        member.get("monthCardEndTime"),
                        member.get("alsign"),
                    ),
                )

            self.connection.execute(
                """
                UPDATE alliances
                SET latest_member_count = ?, updated_at = ?
                WHERE alliance_id = ?
                """,
                (len(members), captured_at, alliance_id),
            )

            if previous_snapshot_id is not None:
                self._save_member_change_events(
                    alliance_id=alliance_id,
                    previous_snapshot_id=previous_snapshot_id,
                    current_snapshot_id=snapshot_id,
                    previous_captured_at=previous_captured_at,
                    current_captured_at=captured_at,
                )

        return alliance_id, len(members)

    @staticmethod
    def _timestamp_epoch(value: str | None) -> int | None:
        if not value:
            return None
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return int(parsed.timestamp())

    @staticmethod
    def _monthly_pass_state(
        expiry: Any,
        captured_at_epoch: int | None,
    ) -> bool | None:
        if expiry is None:
            return None
        try:
            expiry_value = int(expiry)
        except (TypeError, ValueError):
            return None
        if expiry_value <= 0:
            return False
        if captured_at_epoch is None:
            return None
        return expiry_value > captured_at_epoch

    def _insert_member_change_event(
        self,
        *,
        detected_at: str,
        alliance_id: str,
        player_uid: str,
        player_name: str | None,
        event_type: str,
        old_value: Any = None,
        new_value: Any = None,
        numeric_delta: int | None = None,
        previous_snapshot_id: int | None,
        current_snapshot_id: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.connection.execute(
            """
            INSERT OR IGNORE INTO member_change_events (
                detected_at, alliance_id, player_uid, player_name,
                event_type, old_value, new_value, numeric_delta,
                from_snapshot_id, to_snapshot_id, details_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                detected_at,
                alliance_id,
                player_uid,
                player_name,
                event_type,
                None if old_value is None else str(old_value),
                None if new_value is None else str(new_value),
                numeric_delta,
                previous_snapshot_id,
                current_snapshot_id,
                safe_json_dumps(details or {}, compact=True),
            ),
        )

    def _save_member_change_events(
        self,
        *,
        alliance_id: str,
        previous_snapshot_id: int,
        current_snapshot_id: int,
        previous_captured_at: str | None,
        current_captured_at: str,
    ) -> None:
        previous_rows = self.connection.execute(
            """
            SELECT *
            FROM member_entries
            WHERE snapshot_id = ?
            """,
            (previous_snapshot_id,),
        ).fetchall()
        current_rows = self.connection.execute(
            """
            SELECT *
            FROM member_entries
            WHERE snapshot_id = ?
            """,
            (current_snapshot_id,),
        ).fetchall()

        previous = {str(row["player_uid"]): row for row in previous_rows}
        current = {str(row["player_uid"]): row for row in current_rows}
        previous_epoch = self._timestamp_epoch(previous_captured_at)
        current_epoch = self._timestamp_epoch(current_captured_at)

        for player_uid in sorted(current.keys() - previous.keys()):
            row = current[player_uid]
            self._insert_member_change_event(
                detected_at=current_captured_at,
                alliance_id=alliance_id,
                player_uid=player_uid,
                player_name=row["player_name"],
                event_type="joined",
                new_value=row["player_name"],
                previous_snapshot_id=previous_snapshot_id,
                current_snapshot_id=current_snapshot_id,
            )

        for player_uid in sorted(previous.keys() - current.keys()):
            row = previous[player_uid]
            self._insert_member_change_event(
                detected_at=current_captured_at,
                alliance_id=alliance_id,
                player_uid=player_uid,
                player_name=row["player_name"],
                event_type="left",
                old_value=row["player_name"],
                previous_snapshot_id=previous_snapshot_id,
                current_snapshot_id=current_snapshot_id,
            )

        for player_uid in sorted(previous.keys() & current.keys()):
            old = previous[player_uid]
            new = current[player_uid]
            player_name = new["player_name"] or old["player_name"]

            for field, event_type in (
                ("power", "power_changed"),
                ("hq_level", "hq_changed"),
                ("army_kill", "kills_changed"),
            ):
                old_value = old[field]
                new_value = new[field]
                if old_value is None or new_value is None:
                    continue
                delta = int(new_value) - int(old_value)
                if delta == 0:
                    continue
                self._insert_member_change_event(
                    detected_at=current_captured_at,
                    alliance_id=alliance_id,
                    player_uid=player_uid,
                    player_name=player_name,
                    event_type=event_type,
                    old_value=old_value,
                    new_value=new_value,
                    numeric_delta=delta,
                    previous_snapshot_id=previous_snapshot_id,
                    current_snapshot_id=current_snapshot_id,
                )

            old_expiry = old["month_card_expiry_s"]
            new_expiry = new["month_card_expiry_s"]
            old_state = self._monthly_pass_state(old_expiry, previous_epoch)
            new_state = self._monthly_pass_state(new_expiry, current_epoch)

            pass_event: str | None = None
            if old_state is not True and new_state is True:
                pass_event = "monthly_pass_activated"
            elif old_state is True and new_state is False:
                pass_event = "monthly_pass_expired"
            elif (
                old_state is True
                and new_state is True
                and old_expiry is not None
                and new_expiry is not None
                and int(new_expiry) > int(old_expiry)
            ):
                pass_event = "monthly_pass_renewed"

            if pass_event:
                self._insert_member_change_event(
                    detected_at=current_captured_at,
                    alliance_id=alliance_id,
                    player_uid=player_uid,
                    player_name=player_name,
                    event_type=pass_event,
                    old_value=old_expiry,
                    new_value=new_expiry,
                    numeric_delta=(
                        int(new_expiry) - int(old_expiry)
                        if old_expiry is not None and new_expiry is not None
                        else None
                    ),
                    previous_snapshot_id=previous_snapshot_id,
                    current_snapshot_id=current_snapshot_id,
                    details={
                        "old_active": old_state,
                        "new_active": new_state,
                    },
                )

    def backfill_member_change_events(self) -> int:
        """Create missing change events for existing consecutive snapshots."""
        added = 0
        with self._lock, self.connection:
            alliances = self.connection.execute(
                """
                SELECT DISTINCT alliance_id
                FROM member_snapshots
                ORDER BY alliance_id
                """
            ).fetchall()

            for alliance_row in alliances:
                alliance_id = str(alliance_row["alliance_id"])
                snapshots = self.connection.execute(
                    """
                    SELECT snapshot_id, captured_at
                    FROM member_snapshots
                    WHERE alliance_id = ?
                    ORDER BY snapshot_id
                    """,
                    (alliance_id,),
                ).fetchall()

                for previous, current in zip(snapshots, snapshots[1:]):
                    before = self.connection.total_changes
                    self._save_member_change_events(
                        alliance_id=alliance_id,
                        previous_snapshot_id=int(previous["snapshot_id"]),
                        current_snapshot_id=int(current["snapshot_id"]),
                        previous_captured_at=str(previous["captured_at"]),
                        current_captured_at=str(current["captured_at"]),
                    )
                    added += self.connection.total_changes - before

        return added

    def get_alliance_code(self, alliance_id: str) -> str | None:
        with self._lock:
            row = self.connection.execute(
                "SELECT code FROM alliances WHERE alliance_id = ?",
                (alliance_id,),
            ).fetchone()
        return str(row["code"]) if row and row["code"] else None
