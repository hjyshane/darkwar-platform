from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
import sqlite3
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st

from darkwar_tracker.config import load_config
from darkwar_tracker.database import Database
from darkwar_tracker.refresh_control import (
    WORKFLOW_LABELS,
    all_freshness,
    cancel_job,
    current_week_window,
    ensure_weekly_job,
    next_weekly_target,
    queue_job,
)


st.set_page_config(
    page_title="DarkWar 577–584 Intelligence",
    page_icon="🛡️",
    layout="wide",
)

CONFIG = load_config("config.toml")


def connect(path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def query(
    connection: sqlite3.Connection,
    sql: str,
    params: tuple[Any, ...] = (),
) -> pd.DataFrame:
    return pd.read_sql_query(sql, connection, params=params)


def format_power(value: Any) -> str:
    if pd.isna(value):
        return "-"
    number = int(value)
    if abs(number) >= 1_000_000_000:
        return f"{number / 1_000_000_000:.2f}B"
    if abs(number) >= 1_000_000:
        return f"{number / 1_000_000:.1f}M"
    return f"{number:,}"


def format_integer(value: Any) -> str:
    if pd.isna(value):
        return "-"
    return f"{int(value):,}"


def format_delta(value: Any, formatter=format_power) -> str:
    if pd.isna(value):
        return "-"
    number = int(value)
    if number == 0:
        return "0"
    prefix = "+" if number > 0 else ""
    return f"{prefix}{formatter(number)}"


def alliance_label(row: pd.Series) -> str:
    code = row.get("code") or "?"
    server_id = row.get("server_id")
    return f"[{code}] · S{server_id}"


def utc_timestamp(value: Any) -> pd.Timestamp | pd.NaT:
    if value is None or pd.isna(value):
        return pd.NaT
    return pd.to_datetime(value, utc=True, errors="coerce")


def load_snapshot_members(
    connection: sqlite3.Connection,
    snapshot_id: int,
) -> pd.DataFrame:
    return query(
        connection,
        """
        SELECT
            player_uid,
            player_name,
            server_id,
            power,
            hq_level,
            alliance_rank,
            rank_name,
            online,
            offline_time_ms,
            army_kill,
            career_type,
            career_level,
            career_position,
            month_card_expiry_s
        FROM member_entries
        WHERE snapshot_id = ?
        """,
        (snapshot_id,),
    )


def enrich_member_state(
    members: pd.DataFrame,
    snapshot_time: pd.Timestamp,
    pass_warning_days: int,
) -> pd.DataFrame:
    output = members.copy()

    numeric_expiry = pd.to_numeric(
        output["month_card_expiry_s"], errors="coerce"
    )
    output["monthly_pass_expiry"] = pd.to_datetime(
        numeric_expiry.where(numeric_expiry > 0),
        unit="s",
        utc=True,
        errors="coerce",
    )

    now = pd.Timestamp.now(tz="UTC")
    remaining = (
        output["monthly_pass_expiry"] - now
    ).dt.total_seconds() / 86400.0
    output["monthly_pass_days"] = remaining.map(
        lambda value: math.ceil(value) if pd.notna(value) and value > 0 else None
    )

    def pass_status(index: int) -> str:
        raw = numeric_expiry.iloc[index]
        expiry = output["monthly_pass_expiry"].iloc[index]
        if pd.isna(raw):
            return "Unknown"
        if raw <= 0:
            return "Inactive"
        if pd.isna(expiry) or expiry <= now:
            return "Expired"
        days = output["monthly_pass_days"].iloc[index]
        if days is not None and days <= 3:
            return "Expires ≤3d"
        if days is not None and days <= pass_warning_days:
            return f"Expires ≤{pass_warning_days}d"
        return "Active"

    output["monthly_pass_status"] = [
        pass_status(index) for index in range(len(output))
    ]
    output["monthly_pass_active"] = output["monthly_pass_status"].isin(
        ["Active", "Expires ≤3d", f"Expires ≤{pass_warning_days}d"]
    )

    offline_numeric = pd.to_numeric(
        output["offline_time_ms"], errors="coerce"
    )
    offline_dt = pd.to_datetime(
        offline_numeric.where(offline_numeric > 0),
        unit="ms",
        utc=True,
        errors="coerce",
    )
    online_mask = output["online"].fillna(0).astype(bool)
    output["last_seen"] = offline_dt
    output.loc[online_mask, "last_seen"] = snapshot_time
    output["inactive_days"] = (
        (snapshot_time - output["last_seen"]).dt.total_seconds() / 86400.0
    ).clip(lower=0)
    output["online_now"] = online_mask
    return output


def snapshot_options(
    connection: sqlite3.Connection,
    alliance_id: str,
) -> pd.DataFrame:
    snapshots = query(
        connection,
        """
        SELECT snapshot_id, captured_at, member_count, presence_redacted
        FROM member_snapshots
        WHERE alliance_id = ?
        ORDER BY snapshot_id
        """,
        (alliance_id,),
    )
    if not snapshots.empty:
        snapshots["captured_at_dt"] = pd.to_datetime(
            snapshots["captured_at"], utc=True, errors="coerce"
        )
    return snapshots


def choose_reference_snapshot(
    snapshots: pd.DataFrame,
    mode: str,
) -> pd.Series | None:
    if len(snapshots) < 2:
        return None

    latest = snapshots.iloc[-1]
    if mode == "Previous snapshot":
        return snapshots.iloc[-2]

    window = {
        "24 hours": pd.Timedelta(hours=24),
        "7 days": pd.Timedelta(days=7),
        "30 days": pd.Timedelta(days=30),
    }[mode]
    target = latest["captured_at_dt"] - window
    candidates = snapshots[
        snapshots["captured_at_dt"] <= target
    ]
    if not candidates.empty:
        return candidates.iloc[-1]
    return snapshots.iloc[0]


def growth_frame(
    current: pd.DataFrame,
    previous: pd.DataFrame | None,
) -> pd.DataFrame:
    current_fields = current.copy()
    if previous is None or previous.empty:
        current_fields["member_status"] = "current"
        current_fields["power_delta"] = pd.NA
        current_fields["hq_delta"] = pd.NA
        current_fields["kill_delta"] = pd.NA
        return current_fields

    reference = previous[
        ["player_uid", "power", "hq_level", "army_kill"]
    ].rename(
        columns={
            "power": "previous_power",
            "hq_level": "previous_hq",
            "army_kill": "previous_kills",
        }
    )
    merged = current_fields.merge(reference, on="player_uid", how="left")
    merged["member_status"] = merged["previous_power"].map(
        lambda value: "joined" if pd.isna(value) else "stayed"
    )
    merged["power_delta"] = merged["power"] - merged["previous_power"]
    merged["hq_delta"] = merged["hq_level"] - merged["previous_hq"]
    merged["kill_delta"] = merged["army_kill"] - merged["previous_kills"]
    return merged


def own_alliance_options(connection: sqlite3.Connection) -> pd.DataFrame:
    return query(
        connection,
        """
        WITH latest AS (
            SELECT alliance_id, MAX(snapshot_id) AS snapshot_id
            FROM member_snapshots
            GROUP BY alliance_id
        )
        SELECT
            a.alliance_id,
            a.server_id,
            a.code,
            a.full_name,
            ms.snapshot_id,
            ms.captured_at,
            ms.presence_redacted
        FROM latest l
        JOIN member_snapshots ms ON ms.snapshot_id = l.snapshot_id
        JOIN alliances a ON a.alliance_id = l.alliance_id
        WHERE ms.presence_redacted = 0
        ORDER BY a.server_id, a.code
        """,
    )


def select_own_alliance(
    connection: sqlite3.Connection,
    *,
    key: str,
) -> str | None:
    options = own_alliance_options(connection)
    if options.empty:
        st.warning(
            "No non-redacted alliance snapshot exists. Open your own alliance "
            "member list while the collector is running."
        )
        return None

    labels = {
        alliance_label(row): str(row["alliance_id"])
        for _, row in options.iterrows()
    }
    label_list = list(labels)
    default_index = 0
    preferred = CONFIG.activity.own_alliance_code
    if preferred:
        for index, label in enumerate(label_list):
            if label.startswith(f"[{preferred}]"):
                default_index = index
                break

    selected = st.selectbox(
        "Own alliance",
        label_list,
        index=default_index,
        key=key,
    )
    return labels[selected]


def render_overview(connection: sqlite3.Connection) -> None:
    latest_snapshot = query(
        connection,
        "SELECT MAX(snapshot_id) AS snapshot_id FROM ranking_snapshots",
    ).iloc[0]["snapshot_id"]

    if pd.isna(latest_snapshot):
        st.info("Open the cross-server alliance ranking in the game.")
    else:
        ranking = query(
            connection,
            """
            SELECT
                server_id,
                server_rank,
                cross_server_rank,
                '[' || COALESCE(code, '?') || ']' AS alliance,
                fight_power,
                leader,
                member_count,
                alliance_id
            FROM ranking_entries
            WHERE snapshot_id = ? AND server_rank <= 3
            ORDER BY server_id, server_rank
            """,
            (int(latest_snapshot),),
        )
        ranking["power"] = ranking["fight_power"].map(format_power)
        st.subheader("577–584 server Top 3")
        st.dataframe(
            ranking[
                [
                    "server_id",
                    "server_rank",
                    "cross_server_rank",
                    "alliance",
                    "power",
                    "leader",
                    "member_count",
                ]
            ],
            hide_index=True,
            use_container_width=True,
        )

        if not ranking.empty:
            selected_server = st.selectbox(
                "Server power comparison",
                sorted(ranking["server_id"].unique()),
                key="overview_server",
            )
            chart = ranking[
                ranking["server_id"] == selected_server
            ][["alliance", "fight_power"]].set_index("alliance")
            st.bar_chart(chart)

    tracked = query(
        connection,
        """
        WITH latest_member AS (
            SELECT alliance_id, MAX(snapshot_id) AS snapshot_id
            FROM member_snapshots
            GROUP BY alliance_id
        ),
        member_metrics AS (
            SELECT
                me.alliance_id,
                COUNT(*) AS collected_members,
                AVG(me.power) AS average_member_power,
                ms.captured_at
            FROM latest_member lm
            JOIN member_snapshots ms ON ms.snapshot_id = lm.snapshot_id
            JOIN member_entries me ON me.snapshot_id = lm.snapshot_id
            GROUP BY me.alliance_id
        )
        SELECT
            t.server_id,
            t.server_rank,
            '[' || COALESCE(a.code, '?') || ']' AS alliance,
            a.latest_fight_power,
            a.latest_member_count,
            mm.average_member_power,
            CASE WHEN mm.alliance_id IS NULL THEN 'missing'
                 ELSE 'collected' END AS member_data,
            mm.captured_at
        FROM tracked_alliances t
        JOIN alliances a ON a.alliance_id = t.alliance_id
        LEFT JOIN member_metrics mm ON mm.alliance_id = t.alliance_id
        WHERE t.enabled = 1
        ORDER BY t.server_id, t.server_rank
        """,
    )
    if not tracked.empty:
        tracked["alliance_power"] = tracked["latest_fight_power"].map(
            format_power
        )
        tracked["average_member"] = tracked["average_member_power"].map(
            format_power
        )
    st.subheader("Top-3 collection coverage")
    st.dataframe(
        tracked[
            [
                "server_id",
                "server_rank",
                "alliance",
                "alliance_power",
                "average_member",
                "latest_member_count",
                "member_data",
                "captured_at",
            ]
        ] if not tracked.empty else tracked,
        hide_index=True,
        use_container_width=True,
    )


def render_alliance(connection: sqlite3.Connection) -> None:
    alliance_options = query(
        connection,
        """
        SELECT alliance_id, server_id, code, full_name
        FROM alliances
        WHERE code IS NOT NULL
        ORDER BY server_id, code
        """,
    )
    if alliance_options.empty:
        st.info("No alliance metadata has been collected.")
        return

    labels = {
        alliance_label(row): row["alliance_id"]
        for _, row in alliance_options.iterrows()
    }
    selected_label = st.selectbox(
        "Alliance", list(labels), key="alliance_selector"
    )
    alliance_id = labels[selected_label]

    alliance = query(
        connection,
        "SELECT * FROM alliances WHERE alliance_id = ?",
        (alliance_id,),
    ).iloc[0]
    latest_snapshot = query(
        connection,
        """
        SELECT *
        FROM member_snapshots
        WHERE alliance_id = ?
        ORDER BY snapshot_id DESC
        LIMIT 1
        """,
        (alliance_id,),
    )

    if latest_snapshot.empty:
        st.warning(
            "No member snapshot yet. Open this alliance's member list while "
            "the collector is running."
        )
        return

    snapshot = latest_snapshot.iloc[0]
    snapshot_time = utc_timestamp(snapshot["captured_at"])
    members = enrich_member_state(
        load_snapshot_members(connection, int(snapshot["snapshot_id"])),
        snapshot_time,
        CONFIG.activity.pass_expiry_warning_days,
    ).sort_values("power", ascending=False)

    average_power = members["power"].mean()
    median_power = members["power"].median()
    active_passes = int(members["monthly_pass_active"].sum())
    known_passes = int(
        (members["monthly_pass_status"] != "Unknown").sum()
    )

    cols = st.columns(6)
    cols[0].metric("Alliance", f"[{alliance['code']}]")
    cols[1].metric("Total power", format_power(alliance["latest_fight_power"]))
    cols[2].metric("Average member", format_power(average_power))
    cols[3].metric("Median member", format_power(median_power))
    cols[4].metric("Members", int(snapshot["member_count"]))
    cols[5].metric(
        "Monthly pass",
        f"{active_passes}/{known_passes}" if known_passes else "unknown",
    )

    st.caption(
        f"{alliance['full_name'] or '-'} · Server {alliance['server_id']} · "
        f"captured {snapshot['captured_at']}"
    )

    if int(snapshot["presence_redacted"]):
        st.info(
            "This other-alliance snapshot has redacted online, offline, and "
            "location fields."
        )

    table = members.copy()
    table["power"] = table["power"].map(format_power)
    table["army_kill"] = table["army_kill"].map(format_integer)
    table["monthly_pass_expiry"] = table["monthly_pass_expiry"].dt.strftime(
        "%Y-%m-%d"
    )
    table["last_seen"] = table["last_seen"].dt.strftime("%Y-%m-%d %H:%M")
    st.dataframe(
        table[
            [
                "player_name",
                "power",
                "hq_level",
                "alliance_rank",
                "army_kill",
                "online_now",
                "last_seen",
                "monthly_pass_status",
                "monthly_pass_expiry",
                "player_uid",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )

    left, right = st.columns(2)
    with left:
        st.subheader("Top 20 player power")
        st.bar_chart(
            members.head(20)[["player_name", "power"]].set_index(
                "player_name"
            )
        )
    with right:
        st.subheader("HQ distribution")
        st.bar_chart(
            members.groupby("hq_level").size().rename("members").to_frame()
        )


def render_activity(connection: sqlite3.Connection) -> None:
    alliance_id = select_own_alliance(connection, key="activity_alliance")
    if alliance_id is None:
        return

    comparison_mode = st.selectbox(
        "Growth comparison",
        ["Previous snapshot", "24 hours", "7 days", "30 days"],
        key="activity_window",
    )
    snapshots = snapshot_options(connection, alliance_id)
    latest = snapshots.iloc[-1]
    reference = choose_reference_snapshot(snapshots, comparison_mode)

    latest_time = latest["captured_at_dt"]
    current = enrich_member_state(
        load_snapshot_members(connection, int(latest["snapshot_id"])),
        latest_time,
        CONFIG.activity.pass_expiry_warning_days,
    )
    previous = None
    if reference is not None:
        previous = load_snapshot_members(
            connection, int(reference["snapshot_id"])
        )
    growth = growth_frame(current, previous)

    current_total = int(current["power"].fillna(0).sum())
    previous_total = (
        int(previous["power"].fillna(0).sum())
        if previous is not None and not previous.empty
        else None
    )
    total_delta = (
        current_total - previous_total if previous_total is not None else None
    )
    online_count = int(current["online_now"].sum())
    active_24h = int((current["inactive_days"] <= 1).sum())
    inactive_warning = int(
        (current["inactive_days"] >= CONFIG.activity.inactive_warning_days).sum()
    )
    inactive_critical = int(
        (current["inactive_days"] >= CONFIG.activity.inactive_critical_days).sum()
    )
    hq_delta_numeric = pd.to_numeric(
        growth["hq_delta"], errors="coerce"
    ).fillna(0)
    kill_delta_numeric = pd.to_numeric(
        growth["kill_delta"], errors="coerce"
    ).fillna(0)
    hq_upgrades = int((hq_delta_numeric > 0).sum())
    positive_kill_growth = int(kill_delta_numeric.clip(lower=0).sum())

    row1 = st.columns(6)
    row1[0].metric("Members", len(current))
    row1[1].metric("Online now", online_count)
    row1[2].metric("Seen within 24h", active_24h)
    row1[3].metric(
        f"Inactive ≥{CONFIG.activity.inactive_warning_days}d",
        inactive_warning,
    )
    row1[4].metric(
        f"Inactive ≥{CONFIG.activity.inactive_critical_days}d",
        inactive_critical,
    )
    row1[5].metric("Average power", format_power(current["power"].mean()))

    row2 = st.columns(5)
    row2[0].metric("Alliance member power", format_power(current_total))
    row2[1].metric(
        "Power change",
        format_delta(total_delta) if total_delta is not None else "-",
    )
    row2[2].metric("HQ upgrades", hq_upgrades)
    row2[3].metric("Kill increase", format_integer(positive_kill_growth))
    row2[4].metric(
        "Monthly pass active",
        int(current["monthly_pass_active"].sum()),
    )

    if reference is not None:
        st.caption(
            f"Comparison: {reference['captured_at']} → {latest['captured_at']}"
        )
    else:
        st.caption("A second snapshot is required for growth comparison.")

    table = growth.sort_values(
        ["power_delta", "power"], ascending=[False, False], na_position="last"
    ).copy()
    table["power_display"] = table["power"].map(format_power)
    table["power_change"] = table["power_delta"].map(format_delta)
    table["hq_change"] = table["hq_delta"].map(
        lambda value: format_delta(value, format_integer)
    )
    table["kill_change"] = table["kill_delta"].map(
        lambda value: format_delta(value, format_integer)
    )
    table["last_seen_display"] = table["last_seen"].dt.strftime(
        "%Y-%m-%d %H:%M"
    )
    table["inactive_days_display"] = table["inactive_days"].map(
        lambda value: round(float(value), 1) if pd.notna(value) else None
    )

    st.subheader("Member activity and growth")
    st.dataframe(
        table[
            [
                "player_name",
                "member_status",
                "power_display",
                "power_change",
                "hq_level",
                "hq_change",
                "kill_change",
                "online_now",
                "last_seen_display",
                "inactive_days_display",
                "monthly_pass_status",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )

    history_rows = query(
        connection,
        """
        SELECT
            ms.snapshot_id,
            ms.captured_at,
            me.player_uid,
            me.power,
            me.hq_level,
            me.online,
            me.offline_time_ms,
            me.army_kill,
            me.month_card_expiry_s
        FROM member_snapshots ms
        JOIN member_entries me ON me.snapshot_id = ms.snapshot_id
        WHERE ms.alliance_id = ? AND ms.presence_redacted = 0
        ORDER BY ms.snapshot_id
        """,
        (alliance_id,),
    )

    if not history_rows.empty:
        history_rows["captured_at"] = pd.to_datetime(
            history_rows["captured_at"], utc=True, errors="coerce"
        )
        history_rows["pass_active"] = (
            pd.to_numeric(
                history_rows["month_card_expiry_s"], errors="coerce"
            )
            > history_rows["captured_at"].map(
                lambda value: int(value.timestamp()) if pd.notna(value) else 0
            )
        )
        history = (
            history_rows.groupby(["snapshot_id", "captured_at"])
            .agg(
                members=("player_uid", "count"),
                total_power=("power", "sum"),
                average_power=("power", "mean"),
                median_power=("power", "median"),
                online_observed=("online", "sum"),
                monthly_pass_active=("pass_active", "sum"),
            )
            .reset_index()
        )

        if len(history) >= 2:
            st.subheader("Alliance growth history")
            left, right = st.columns(2)
            with left:
                st.line_chart(
                    history.set_index("captured_at")[["total_power"]]
                )
            with right:
                st.line_chart(
                    history.set_index("captured_at")[[
                        "online_observed",
                        "monthly_pass_active",
                    ]]
                )


def render_monthly_pass(connection: sqlite3.Connection) -> None:
    alliance_id = select_own_alliance(connection, key="pass_alliance")
    if alliance_id is None:
        return

    snapshots = snapshot_options(connection, alliance_id)
    latest = snapshots.iloc[-1]
    members = enrich_member_state(
        load_snapshot_members(connection, int(latest["snapshot_id"])),
        latest["captured_at_dt"],
        CONFIG.activity.pass_expiry_warning_days,
    )

    active = int(members["monthly_pass_active"].sum())
    known = int((members["monthly_pass_status"] != "Unknown").sum())
    unknown = int((members["monthly_pass_status"] == "Unknown").sum())
    expiring_3 = int((members["monthly_pass_status"] == "Expires ≤3d").sum())
    expiring_warning = int(
        (
            members["monthly_pass_status"]
            == f"Expires ≤{CONFIG.activity.pass_expiry_warning_days}d"
        ).sum()
    )
    inactive = known - active

    cols = st.columns(6)
    cols[0].metric("Active", active)
    cols[1].metric(
        "Active rate",
        f"{active / known * 100:.1f}%" if known else "unknown",
    )
    cols[2].metric("Expires ≤3d", expiring_3)
    cols[3].metric(
        f"Expires ≤{CONFIG.activity.pass_expiry_warning_days}d",
        expiring_warning,
    )
    cols[4].metric("Inactive / expired", inactive)
    cols[5].metric("Unknown", unknown)

    table = members.sort_values(
        ["monthly_pass_active", "monthly_pass_expiry", "power"],
        ascending=[False, True, False],
        na_position="last",
    ).copy()
    table["power_display"] = table["power"].map(format_power)
    table["expiry"] = table["monthly_pass_expiry"].dt.strftime(
        "%Y-%m-%d %H:%M UTC"
    )
    st.subheader("Current monthly-pass status")
    st.dataframe(
        table[
            [
                "player_name",
                "power_display",
                "hq_level",
                "alliance_rank",
                "monthly_pass_status",
                "monthly_pass_days",
                "expiry",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )

    events = query(
        connection,
        """
        SELECT
            detected_at,
            player_name,
            event_type,
            old_value,
            new_value,
            numeric_delta
        FROM member_change_events
        WHERE alliance_id = ?
          AND event_type LIKE 'monthly_pass_%'
        ORDER BY event_id DESC
        LIMIT 200
        """,
        (alliance_id,),
    )
    st.subheader("Detected monthly-pass changes")
    if events.empty:
        st.info(
            "No pass change has been detected yet. Collect the same alliance "
            "again after a member activates, renews, or expires."
        )
    else:
        for column in ("old_value", "new_value"):
            numeric = pd.to_numeric(events[column], errors="coerce")
            events[column.replace("_value", "_expiry")] = pd.to_datetime(
                numeric.where(numeric > 0),
                unit="s",
                utc=True,
                errors="coerce",
            ).dt.strftime("%Y-%m-%d")
        events["event"] = events["event_type"].map(
            {
                "monthly_pass_activated": "Activated",
                "monthly_pass_renewed": "Renewed",
                "monthly_pass_expired": "Expired",
            }
        )
        st.dataframe(
            events[
                [
                    "detected_at",
                    "player_name",
                    "event",
                    "old_expiry",
                    "new_expiry",
                ]
            ],
            hide_index=True,
            use_container_width=True,
        )


def render_player(connection: sqlite3.Connection) -> None:
    search = st.text_input(
        "Search player name or UID",
        placeholder="Enter part of a name or UID",
    )
    if not search:
        st.info(
            "Search a collected member, ranking player, or opened profile."
        )
        return

    matches = query(
        connection,
        """
        WITH latest_member AS (
            SELECT me.*
            FROM member_entries me
            JOIN (
                SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                FROM member_entries
                GROUP BY player_uid
            ) latest
              ON latest.player_uid = me.player_uid
             AND latest.snapshot_id = me.snapshot_id
        ),
        latest_profile AS (
            SELECT pp.*
            FROM player_profile_snapshots pp
            JOIN (
                SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                FROM player_profile_snapshots
                GROUP BY player_uid
            ) latest
              ON latest.player_uid = pp.player_uid
             AND latest.snapshot_id = pp.snapshot_id
        ),
        latest_public AS (
            SELECT pi.*
            FROM player_public_info_snapshots pi
            JOIN (
                SELECT player_uid, MAX(snapshot_id) AS snapshot_id
                FROM player_public_info_snapshots
                GROUP BY player_uid
            ) latest
              ON latest.player_uid = pi.player_uid
             AND latest.snapshot_id = pi.snapshot_id
        )
        SELECT
            p.player_uid,
            COALESCE(
                lp.player_name,
                lpub.player_name,
                lm.player_name,
                p.player_name
            ) AS player_name,
            COALESCE(
                lp.server_id,
                lpub.server_id,
                lm.server_id,
                p.server_id
            ) AS server_id,
            COALESCE(
                lp.current_power,
                lpub.power,
                lm.power
            ) AS power,
            COALESCE(
                lp.base_level,
                lpub.main_building_level,
                lm.hq_level
            ) AS hq_level,
            COALESCE(
                lp.alliance_code,
                lpub.alliance_code
            ) AS alliance_code,
            lp.snapshot_id AS profile_snapshot_id,
            lpub.snapshot_id AS public_snapshot_id
        FROM players p
        LEFT JOIN latest_member lm ON lm.player_uid = p.player_uid
        LEFT JOIN latest_profile lp ON lp.player_uid = p.player_uid
        LEFT JOIN latest_public lpub ON lpub.player_uid = p.player_uid
        WHERE COALESCE(
                lp.player_name,
                lpub.player_name,
                lm.player_name,
                p.player_name,
                ''
              ) LIKE ?
           OR p.player_uid LIKE ?
        ORDER BY power DESC
        LIMIT 200
        """,
        (f"%{search}%", f"%{search}%"),
    )

    if matches.empty:
        st.warning("No matching player in collected data.")
        return

    matches["power_display"] = matches["power"].map(format_power)
    matches["alliance"] = matches["alliance_code"].map(
        lambda value: f"[{value}]" if pd.notna(value) and value else "-"
    )
    matches["detailed_profile"] = matches["profile_snapshot_id"].map(
        lambda value: "collected" if pd.notna(value) else "missing"
    )

    st.dataframe(
        matches[
            [
                "player_name",
                "player_uid",
                "server_id",
                "alliance",
                "power_display",
                "hq_level",
                "detailed_profile",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )

    label_map = {
        (
            f"{row['player_name'] or row['player_uid']} · "
            f"S{row['server_id']} · {row['player_uid']}"
        ): str(row["player_uid"])
        for _, row in matches.iterrows()
    }
    selected_label = st.selectbox(
        "Player details",
        list(label_map),
        key="player_detail_selector",
    )
    selected_uid = label_map[selected_label]

    profile = query(
        connection,
        """
        SELECT *
        FROM player_profile_snapshots
        WHERE player_uid = ?
        ORDER BY snapshot_id DESC
        LIMIT 1
        """,
        (selected_uid,),
    )
    public = query(
        connection,
        """
        SELECT *
        FROM player_public_info_snapshots
        WHERE player_uid = ?
        ORDER BY snapshot_id DESC
        LIMIT 1
        """,
        (selected_uid,),
    )

    if profile.empty:
        st.warning(
            "Detailed combat-power profile has not been captured. "
            "Open this player's profile while the collector is running."
        )
    else:
        row = profile.iloc[0]
        components = [
            ("Building", "building_power"),
            ("Science", "science_power"),
            ("Hero", "hero_power"),
            ("Army", "army_power"),
            ("Vehicle", "vehicle_power"),
            ("Pet", "pet_power"),
        ]
        component_total = sum(
            int(row[column]) if pd.notna(row[column]) else 0
            for _, column in components
        )
        current_power = (
            int(row["current_power"])
            if pd.notna(row["current_power"])
            else None
        )

        metric_row = st.columns(6)
        metric_row[0].metric("Current power", format_power(current_power))
        metric_row[1].metric(
            "Reported max",
            format_power(row["reported_max_power"]),
        )
        metric_row[2].metric("HQ", format_integer(row["base_level"]))
        metric_row[3].metric("Army kills", format_integer(row["army_kill"]))
        metric_row[4].metric("Battle wins", format_integer(row["battle_win"]))
        metric_row[5].metric("Battle losses", format_integer(row["battle_lose"]))

        if current_power is not None:
            difference = current_power - component_total
            if difference == 0:
                st.caption(
                    "The six captured combat-power components sum exactly "
                    "to current power."
                )
            else:
                st.caption(
                    f"Component sum differs from current power by "
                    f"{format_delta(difference)}."
                )

        breakdown = pd.DataFrame(
            {
                "category": [label for label, _ in components],
                "power": [
                    int(row[column]) if pd.notna(row[column]) else 0
                    for _, column in components
                ],
            }
        )
        breakdown["display"] = breakdown["power"].map(format_power)

        left, right = st.columns(2)
        with left:
            st.subheader("Combat-power breakdown")
            st.dataframe(
                breakdown[["category", "display"]],
                hide_index=True,
                use_container_width=True,
            )
        with right:
            st.subheader("Power composition")
            st.bar_chart(breakdown.set_index("category")[["power"]])

        stats = pd.DataFrame(
            [
                ("Army dead", row["army_dead"]),
                ("Scouts", row["scout_count"]),
                ("Likes", row["likes"]),
                ("Profile captured", row["captured_at"]),
            ],
            columns=["metric", "value"],
        )
        st.dataframe(stats, hide_index=True, use_container_width=True)

    if not public.empty:
        row = public.iloc[0]
        st.subheader("Supplementary public profile")
        public_metrics = pd.DataFrame(
            [
                ("VIP level", row["vip_level"]),
                ("SVIP level", row["svip_level"]),
                ("Max hero ID", row["max_hero_id"]),
                ("Max hero power field", row["max_power"]),
                ("Migration power field", row["migrate_power"]),
                ("Language", row["language"]),
                ("Public info captured", row["captured_at"]),
            ],
            columns=["metric", "value"],
        )
        st.dataframe(
            public_metrics,
            hide_index=True,
            use_container_width=True,
        )

    rank_history = query(
        connection,
        """
        SELECT
            prs.captured_at,
            pre.cross_server_rank,
            pre.power,
            pre.hq_level,
            pre.alliance_code,
            pre.server_id
        FROM player_ranking_entries pre
        JOIN player_ranking_snapshots prs
          ON prs.snapshot_id = pre.snapshot_id
        WHERE pre.player_uid = ?
        ORDER BY prs.captured_at
        """,
        (selected_uid,),
    )
    if not rank_history.empty:
        st.subheader("Cross-server ranking history")
        st.dataframe(
            rank_history,
            hide_index=True,
            use_container_width=True,
        )

    member_trend = query(
        connection,
        """
        SELECT
            ms.captured_at,
            me.power,
            me.hq_level,
            me.army_kill,
            '[' || COALESCE(a.code, '?') || ']' AS alliance
        FROM member_entries me
        JOIN member_snapshots ms ON ms.snapshot_id = me.snapshot_id
        LEFT JOIN alliances a ON a.alliance_id = me.alliance_id
        WHERE me.player_uid = ?
        ORDER BY ms.captured_at
        """,
        (selected_uid,),
    )
    if len(member_trend) >= 2:
        member_trend["captured_at"] = pd.to_datetime(
            member_trend["captured_at"],
            utc=True,
        )
        st.subheader("Member power trend")
        st.line_chart(
            member_trend.set_index("captured_at")[["power"]]
        )


def render_arena(connection: sqlite3.Connection) -> None:
    matches = query(
        connection,
        """
        SELECT
            match_id,
            base_server,
            fight_servers,
            opponent_servers,
            start_time_ms,
            end_time_ms,
            arena_type,
            user_arena_type,
            status,
            first_seen_at,
            last_seen_at
        FROM arena_matches
        ORDER BY start_time_ms DESC, match_id DESC
        """,
    )
    if matches.empty:
        st.info(
            "Open the Arena main/ranking screen while the collector is "
            "running. The weekly matchup will be created automatically."
        )
        return

    def match_label(row: pd.Series) -> str:
        start = pd.to_datetime(
            row["start_time_ms"], unit="ms", utc=True, errors="coerce"
        )
        end = pd.to_datetime(
            row["end_time_ms"], unit="ms", utc=True, errors="coerce"
        )
        if pd.notna(start):
            start = start.tz_convert("America/New_York")
        if pd.notna(end):
            end = end.tz_convert("America/New_York")
        period = (
            f"{start.strftime('%Y-%m-%d')} → {end.strftime('%Y-%m-%d')}"
            if pd.notna(start) and pd.notna(end)
            else "unknown period"
        )
        opponents = row["opponent_servers"] or "?"
        return (
            f"S{int(row['base_server'])} vs S{opponents} · "
            f"{period} · {row['status']}"
        )

    labels = {
        match_label(row): int(row["match_id"])
        for _, row in matches.iterrows()
    }
    selected_label = st.selectbox(
        "Arena week",
        list(labels),
        key="arena_match_selector",
    )
    match_id = labels[selected_label]
    match = matches[matches["match_id"] == match_id].iloc[0]

    snapshots = query(
        connection,
        """
        SELECT *
        FROM arena_snapshots
        WHERE match_id = ?
        ORDER BY snapshot_id DESC
        """,
        (match_id,),
    )
    if snapshots.empty:
        st.warning("The match exists but has no ranking snapshot.")
        return

    snapshot_labels = {
        f"{row['captured_at']} · {int(row['player_count'])} players":
            int(row["snapshot_id"])
        for _, row in snapshots.iterrows()
    }
    selected_snapshot = st.selectbox(
        "Ranking snapshot",
        list(snapshot_labels),
        key="arena_snapshot_selector",
    )
    snapshot_id = snapshot_labels[selected_snapshot]
    snapshot = snapshots[snapshots["snapshot_id"] == snapshot_id].iloc[0]

    start = pd.to_datetime(
        match["start_time_ms"], unit="ms", utc=True, errors="coerce"
    )
    end = pd.to_datetime(
        match["end_time_ms"], unit="ms", utc=True, errors="coerce"
    )
    if pd.notna(start):
        start = start.tz_convert("America/New_York")
    if pd.notna(end):
        end = end.tz_convert("America/New_York")

    metrics = st.columns(6)
    metrics[0].metric(
        "Match",
        f"S{int(match['base_server'])} vs S{match['opponent_servers'] or '?'}",
    )
    metrics[1].metric("Ranked players", int(snapshot["player_count"]))
    metrics[2].metric(
        "Own defense power",
        format_power(snapshot["own_defense_power"]),
    )
    metrics[3].metric(
        "Alliance top rank field",
        format_integer(snapshot["alliance_top_rank"]),
    )
    metrics[4].metric(
        "Storm lowest rank",
        format_integer(snapshot["storm_lowest_rank"]),
    )
    metrics[5].metric("Snapshots", len(snapshots))

    st.caption(
        f"Arena period (America/New_York): "
        f"{start.strftime('%Y-%m-%d %H:%M') if pd.notna(start) else '-'} → "
        f"{end.strftime('%Y-%m-%d %H:%M') if pd.notna(end) else '-'}"
    )

    ranking = query(
        connection,
        """
        SELECT
            arena_rank,
            player_name,
            player_uid,
            server_id,
            current_server_id,
            alliance_code,
            alliance_name,
            score,
            power,
            main_build_point,
            country,
            career_type,
            career_level,
            CASE WHEN army_blob IS NULL OR army_blob = ''
                 THEN 0 ELSE 1 END AS has_army_blob
        FROM arena_ranking_entries
        WHERE snapshot_id = ?
        ORDER BY arena_rank
        """,
        (snapshot_id,),
    )
    if ranking.empty:
        st.info("No ranking rows were stored for this snapshot.")
        return

    server_options = ["All"] + [
        str(value) for value in sorted(ranking["server_id"].dropna().unique())
    ]
    controls = st.columns([1, 1, 1, 2])
    with controls[0]:
        selected_server = st.selectbox(
            "Server",
            server_options,
            key="arena_server_filter",
        )
    with controls[1]:
        top_n = st.selectbox(
            "Rank range",
            [10, 25, 50, 100],
            index=3,
            key="arena_top_n",
        )
    alliance_values = sorted(
        value for value in ranking["alliance_code"].dropna().unique()
        if str(value).strip()
    )
    with controls[2]:
        selected_alliance = st.selectbox(
            "Alliance",
            ["All"] + alliance_values,
            key="arena_alliance_filter",
        )
    with controls[3]:
        player_search = st.text_input(
            "Player search",
            key="arena_player_search",
        )

    filtered = ranking[ranking["arena_rank"] <= top_n].copy()
    if selected_server != "All":
        filtered = filtered[
            filtered["server_id"] == int(selected_server)
        ]
    if selected_alliance != "All":
        filtered = filtered[
            filtered["alliance_code"] == selected_alliance
        ]
    if player_search:
        mask = (
            filtered["player_name"].fillna("").str.contains(
                player_search, case=False, regex=False
            )
            | filtered["player_uid"].fillna("").str.contains(
                player_search, case=False, regex=False
            )
        )
        filtered = filtered[mask]

    filtered["alliance"] = filtered.apply(
        lambda row: (
            f"[{row['alliance_code']}]"
            if pd.notna(row["alliance_code"]) and row["alliance_code"]
            else "-"
        ),
        axis=1,
    )
    filtered["power_display"] = filtered["power"].map(format_power)
    filtered["main_build_point_display"] = filtered[
        "main_build_point"
    ].map(format_integer)

    st.subheader("Arena ranking")
    st.dataframe(
        filtered[
            [
                "arena_rank",
                "player_name",
                "server_id",
                "alliance",
                "score",
                "power_display",
                "main_build_point_display",
                "country",
                "player_uid",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )

    server_summary = (
        ranking.groupby("server_id", dropna=False)
        .agg(
            ranked_players=("player_uid", "count"),
            top10_players=("arena_rank", lambda values: int((values <= 10).sum())),
            best_rank=("arena_rank", "min"),
            average_score=("score", "mean"),
            average_power=("power", "mean"),
        )
        .reset_index()
    )
    server_summary["average_score"] = server_summary["average_score"].round(1)
    server_summary["average_power"] = server_summary["average_power"].map(
        format_power
    )
    st.subheader("Server comparison")
    st.dataframe(server_summary, hide_index=True, use_container_width=True)

    alliance_summary = (
        ranking.assign(
            alliance=ranking["alliance_code"].fillna("No alliance")
        )
        .groupby(["server_id", "alliance"], dropna=False)
        .agg(
            ranked_players=("player_uid", "count"),
            best_rank=("arena_rank", "min"),
            average_score=("score", "mean"),
            average_power=("power", "mean"),
        )
        .reset_index()
        .sort_values(["best_rank", "ranked_players"], ascending=[True, False])
    )
    alliance_summary["average_score"] = alliance_summary[
        "average_score"
    ].round(1)
    alliance_summary["average_power"] = alliance_summary[
        "average_power"
    ].map(format_power)
    st.subheader("Alliance representation")
    st.dataframe(
        alliance_summary,
        hide_index=True,
        use_container_width=True,
    )

    if len(snapshots) >= 2:
        previous_id = int(snapshots.iloc[1]["snapshot_id"])
        movement = query(
            connection,
            """
            WITH current AS (
                SELECT player_uid, player_name, arena_rank, score, power
                FROM arena_ranking_entries
                WHERE snapshot_id = ?
            ),
            previous AS (
                SELECT player_uid, arena_rank, score, power
                FROM arena_ranking_entries
                WHERE snapshot_id = ?
            )
            SELECT
                c.player_name,
                c.player_uid,
                p.arena_rank AS previous_rank,
                c.arena_rank AS current_rank,
                p.arena_rank - c.arena_rank AS rank_gain,
                c.score - p.score AS score_delta,
                c.power - p.power AS power_delta
            FROM current c
            LEFT JOIN previous p ON p.player_uid = c.player_uid
            ORDER BY rank_gain DESC, c.arena_rank
            """,
            (snapshot_id, previous_id),
        )
        st.subheader("Change from previous snapshot")
        st.dataframe(movement, hide_index=True, use_container_width=True)

    st.info(
        "The ranking response includes an encoded army/formation blob for "
        "each player. It is stored for later protobuf analysis, but hero and "
        "unit composition are not decoded in this version."
    )


def render_changes(connection: sqlite3.Connection) -> None:
    alliance_options = query(
        connection,
        """
        SELECT DISTINCT a.alliance_id, a.server_id, a.code
        FROM alliances a
        JOIN member_change_events e ON e.alliance_id = a.alliance_id
        ORDER BY a.server_id, a.code
        """,
    )
    if alliance_options.empty:
        st.info(
            "No change events yet. Collect an alliance at least twice to create "
            "growth, membership, and pass events."
        )
        return

    labels = {
        alliance_label(row): str(row["alliance_id"])
        for _, row in alliance_options.iterrows()
    }
    selected = st.selectbox("Alliance", list(labels), key="change_alliance")
    alliance_id = labels[selected]

    event_labels = {
        "joined": "Joined",
        "left": "Left",
        "power_changed": "Power",
        "hq_changed": "HQ",
        "kills_changed": "Kills",
        "monthly_pass_activated": "Pass activated",
        "monthly_pass_renewed": "Pass renewed",
        "monthly_pass_expired": "Pass expired",
    }
    selected_types = st.multiselect(
        "Event types",
        list(event_labels),
        default=list(event_labels),
        format_func=lambda value: event_labels[value],
    )
    if not selected_types:
        st.info("Select at least one event type.")
        return

    placeholders = ",".join("?" for _ in selected_types)
    events = query(
        connection,
        f"""
        SELECT
            detected_at,
            player_name,
            event_type,
            old_value,
            new_value,
            numeric_delta
        FROM member_change_events
        WHERE alliance_id = ?
          AND event_type IN ({placeholders})
        ORDER BY event_id DESC
        LIMIT 1000
        """,
        (alliance_id, *selected_types),
    )
    events["event"] = events["event_type"].map(event_labels)
    events["delta"] = events["numeric_delta"].map(
        lambda value: format_delta(value, format_integer)
    )
    st.dataframe(
        events[
            [
                "detected_at",
                "player_name",
                "event",
                "old_value",
                "new_value",
                "delta",
            ]
        ],
        hide_index=True,
        use_container_width=True,
    )


def _refresh_status_label(
    workflow_id: str,
    freshness: Any,
    active_steps: pd.DataFrame,
) -> tuple[str, str]:
    if not active_steps.empty:
        matching = active_steps[active_steps["workflow_id"] == workflow_id]
        if not matching.empty:
            statuses = set(matching["job_status"].astype(str))
            if "running" in statuses:
                return "Running", "Automation is currently executing."
            if "waiting_setup" in statuses:
                return "Setup required", "Calibrate this workflow before it can run."
            if "waiting_idle" in statuses:
                return "Waiting for idle", "No game or screen changes while you are active."
            return "Pending", "Queued for the next idle period."

    if freshness.current:
        return "Current", "Captured after this week's server reset."
    if freshness.latest_at:
        return "Stale", "Latest snapshot is from the previous weekly window."
    return "Missing", "No snapshot has been collected yet."


def _display_time(value: dt.datetime | None) -> str:
    if value is None:
        return "-"
    local = value.astimezone(ZoneInfo("America/New_York"))
    return (
        f"{local.strftime('%Y-%m-%d %H:%M %Z')} · "
        f"{value.strftime('%Y-%m-%d %H:%M UTC')}"
    )


def render_refresh_center(connection: sqlite3.Connection) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    window = current_week_window(now, CONFIG)
    ensure_weekly_job(db_path, CONFIG, now=now)

    st.subheader("갱신 관리 · Refresh Center")
    if not CONFIG.refresh_automation.enabled:
        st.error(
            "Refresh Worker is disabled in config.toml. Run "
            "scripts\add_refresh_config.py or set "
            "refresh_automation.enabled = true."
        )

    st.caption(
        "Passive capture is preferred. Manual and weekly jobs only operate "
        "after Windows has been idle long enough; renewed activity pauses "
        "automation before the next tap."
    )

    schedule_cols = st.columns(4)
    schedule_cols[0].metric("Current weekly reset", _display_time(window.reset_at))
    schedule_cols[1].metric("Weekly refresh target", _display_time(window.scheduled_at))
    schedule_cols[2].metric(
        "Next weekly target",
        _display_time(next_weekly_target(now, CONFIG)),
    )
    schedule_cols[3].metric(
        "Required idle",
        f"{CONFIG.refresh_automation.idle_seconds_required // 60} min",
    )

    active_steps = query(
        connection,
        """
        SELECT
            j.job_id,
            j.job_type,
            j.status AS job_status,
            j.trigger_type,
            j.current_step,
            s.workflow_id,
            s.status AS step_status
        FROM refresh_jobs j
        JOIN refresh_job_steps s ON s.job_id = j.job_id
        WHERE j.status IN (
            'queued', 'waiting_idle', 'running',
            'waiting_setup', 'partial'
        )
        ORDER BY j.priority, j.job_id, s.step_order
        """,
    )
    freshness_map = all_freshness(connection, window.reset_at, CONFIG)

    completed_steps = query(
        connection,
        """
        SELECT workflow_id, details_json, finished_at
        FROM refresh_job_steps
        WHERE status = 'succeeded'
          AND finished_at IS NOT NULL
        ORDER BY step_id DESC
        """,
    )
    completion_source: dict[str, str] = {}
    for _, completed in completed_steps.iterrows():
        workflow_id = str(completed["workflow_id"])
        if workflow_id in completion_source:
            continue
        try:
            detail = json.loads(str(completed["details_json"] or "{}"))
        except json.JSONDecodeError:
            detail = {}
        completion = detail.get("completion")
        completion_source[workflow_id] = (
            "Automated" if completion == "automation" else "Passive"
        )
    if completion_source.get("full_weekly_ui") == "Automated":
        for workflow_id in (
            "rankings", "my_alliance", "tracked_alliances"
        ):
            completion_source.setdefault(workflow_id, "Automated")

    full_weekly_sequence = (
        CONFIG.refresh_automation.sequence_dir / "full_weekly_ui.json"
    )
    if not full_weekly_sequence.is_file():
        st.warning(
            "Weekly Arena refresh is ready, but the combined Full Weekly UI "
            "path is not calibrated yet. Run calibrate_refresh.bat once and "
            "choose Full Weekly. The queued job will wait in Setup required "
            "state instead of touching the game."
        )

    readiness = {
        "arena": True,
        "rankings": (
            CONFIG.refresh_automation.sequence_dir / "rankings.json"
        ).is_file(),
        "my_alliance": (
            CONFIG.refresh_automation.sequence_dir / "my_alliance.json"
        ).is_file(),
        "tracked_alliances": (
            CONFIG.refresh_automation.sequence_dir / "tracked_alliances.json"
        ).is_file(),
    }

    rows: list[dict[str, Any]] = []
    for workflow_id in (
        "arena", "rankings", "my_alliance", "tracked_alliances"
    ):
        label = WORKFLOW_LABELS[workflow_id]
        fresh = freshness_map[workflow_id]
        status, note = _refresh_status_label(
            workflow_id,
            fresh,
            active_steps,
        )
        if status == "Current":
            source = completion_source.get(workflow_id, "Passive")
            status = f"Current · {source}"
        coverage = "-"
        if fresh.coverage_total is not None:
            coverage = f"{fresh.coverage_current}/{fresh.coverage_total}"
        rows.append(
            {
                "dataset": label,
                "status": status,
                "latest_snapshot": _display_time(fresh.latest_at),
                "weekly_coverage": coverage,
                "automation_ready": (
                    "Ready" if readiness[workflow_id] else "Calibration needed"
                ),
                "note": note,
            }
        )

    st.dataframe(
        pd.DataFrame(rows),
        hide_index=True,
        use_container_width=True,
    )

    st.subheader("수동 갱신 요청")
    st.caption(
        "Buttons add a request to the queue. They do not immediately change "
        "the game screen. Natural packets arriving after the request can "
        "complete the job without automation."
    )

    button_cols = st.columns(5)
    manual_jobs = [
        ("arena", "Arena"),
        ("rankings", "Rankings"),
        ("my_alliance", "My Alliance"),
        ("tracked_alliances", "Tracked Alliances"),
        ("full_weekly", "Full Refresh"),
    ]
    for column, (job_type, label) in zip(button_cols, manual_jobs):
        if column.button(label, key=f"queue_{job_type}", use_container_width=True):
            job_id = queue_job(
                db_path,
                job_type,
                config=CONFIG,
                trigger_type="manual",
                fresh_after=now,
                priority=50 if job_type == "full_weekly" else 100,
                idle_required=True,
                details={"requested_from": "dashboard"},
            )
            st.success(f"Queued refresh job #{job_id}: {label}")
            st.rerun()

    st.subheader("Queue and history")
    jobs = query(
        connection,
        """
        SELECT
            job_id,
            job_type,
            trigger_type,
            week_key,
            status,
            current_step,
            requested_at,
            scheduled_for,
            started_at,
            finished_at,
            attempt_count,
            last_error
        FROM refresh_jobs
        ORDER BY job_id DESC
        LIMIT 100
        """,
    )
    if jobs.empty:
        st.info("No refresh jobs have been created yet.")
    else:
        jobs["job"] = jobs["job_type"].map(
            {
                "arena": "Arena",
                "rankings": "Rankings",
                "my_alliance": "My Alliance",
                "tracked_alliances": "Tracked Alliances",
                "full_weekly": "Full Weekly",
            }
        ).fillna(jobs["job_type"])
        st.dataframe(
            jobs[
                [
                    "job_id",
                    "job",
                    "trigger_type",
                    "status",
                    "current_step",
                    "requested_at",
                    "scheduled_for",
                    "attempt_count",
                    "last_error",
                ]
            ],
            hide_index=True,
            use_container_width=True,
        )

        cancellable = jobs[
            jobs["status"].isin(
                ["queued", "waiting_idle", "waiting_setup", "partial"]
            )
        ]
        if not cancellable.empty:
            labels = {
                f"#{int(row['job_id'])} · {row['job']} · {row['status']}": int(
                    row["job_id"]
                )
                for _, row in cancellable.iterrows()
            }
            selected = st.selectbox(
                "Cancel pending job",
                list(labels),
                key="cancel_refresh_job",
            )
            if st.button("Cancel selected", key="cancel_selected_refresh"):
                if cancel_job(db_path, labels[selected]):
                    st.success("Refresh job cancelled.")
                    st.rerun()

    with st.expander("Automation setup and policy"):
        st.markdown(
            f"""
- Weekly full refresh: **Monday {CONFIG.refresh_automation.reset_hour_utc:02d}:{CONFIG.refresh_automation.reset_minute_utc:02d} UTC + {CONFIG.refresh_automation.weekly_delay_seconds // 60} minutes**
- User idle requirement: **{CONFIG.refresh_automation.idle_seconds_required} seconds**
- Arena: game restart during idle; `user.get.arena.info` is verified from SQLite
- Recommended one-time Full Weekly sequence: `{CONFIG.refresh_automation.sequence_dir / 'full_weekly_ui.json'}`
- Optional Rankings-only sequence: `{CONFIG.refresh_automation.sequence_dir / 'rankings.json'}`
- Optional My-alliance-only sequence: `{CONFIG.refresh_automation.sequence_dir / 'my_alliance.json'}`
- Optional Tracked-alliance-only sequence: `{CONFIG.refresh_automation.sequence_dir / 'tracked_alliances.json'}`
- Worker log: `logs/refresh_worker.log`
            """
        )
        st.warning(
            "Weekly automation cannot execute a UI workflow until its one-time "
            "tap sequence has been calibrated. Missing workflows remain in "
            "Setup required state; existing dashboard data is not deleted."
        )


def render_capture_status(connection: sqlite3.Connection) -> None:
    events = query(
        connection,
        """
        SELECT captured_at, direction, command, request_id
        FROM capture_events
        ORDER BY event_id DESC
        LIMIT 100
        """,
    )
    st.subheader("Latest captured extension events")
    st.dataframe(events, hide_index=True, use_container_width=True)

    collection = query(
        connection,
        """
        SELECT
            '[' || COALESCE(a.code, '?') || ']' AS alliance,
            a.server_id,
            ms.captured_at,
            ms.member_count,
            ms.presence_redacted
        FROM member_snapshots ms
        JOIN alliances a ON a.alliance_id = ms.alliance_id
        WHERE ms.snapshot_id IN (
            SELECT MAX(snapshot_id)
            FROM member_snapshots
            GROUP BY alliance_id
        )
        ORDER BY a.server_id, a.code
        """,
    )
    st.subheader("Latest member snapshots")
    st.dataframe(collection, hide_index=True, use_container_width=True)


st.title("DarkWar 577–584 Dashboard")
st.caption(
    "Passive capture · idle-aware weekly refresh · arena · rankings · player profiles"
)

db_path = st.sidebar.text_input(
    "SQLite database",
    value=str(CONFIG.database.path),
)
refresh_choices = {
    "Off": None,
    "10 seconds": "10s",
    "30 seconds": "30s",
    "60 seconds": "60s",
    "5 minutes": "5m",
}
configured_label = {
    0: "Off",
    10: "10 seconds",
    30: "30 seconds",
    60: "60 seconds",
    300: "5 minutes",
}.get(CONFIG.activity.auto_refresh_seconds, "30 seconds")
refresh_label = st.sidebar.selectbox(
    "Auto refresh",
    list(refresh_choices),
    index=list(refresh_choices).index(configured_label),
)
run_every = refresh_choices[refresh_label]
if st.sidebar.button("Refresh now"):
    st.rerun()
st.sidebar.caption(
    "The collector can write to SQLite while this dashboard is open."
)

if not Path(db_path).exists():
    st.error(f"Database not found: {db_path}")
    st.stop()

# Ensure a patched dashboard can open an existing pre-v0.2.1 database.
schema_database = Database(db_path, top_n=CONFIG.tracking.top_n)
schema_database.close()


@st.fragment(run_every=run_every)
def render_dashboard() -> None:
    connection = connect(db_path)
    try:
        totals = query(
            connection,
            """
            SELECT
              (SELECT COUNT(*) FROM alliances) AS alliances,
              (SELECT COUNT(*) FROM players) AS players,
              (SELECT COUNT(*) FROM ranking_snapshots) AS ranking_snapshots,
              (SELECT COUNT(*) FROM member_snapshots) AS member_snapshots,
              (SELECT COUNT(*) FROM member_change_events) AS change_events,
              (SELECT COUNT(*) FROM player_profile_snapshots) AS profiles,
              (SELECT COUNT(*) FROM arena_snapshots) AS arena_snapshots,
              (SELECT COUNT(*) FROM refresh_jobs WHERE status IN (
                  'queued', 'waiting_idle', 'running', 'waiting_setup', 'partial'
              )) AS pending_refresh_jobs
            """,
        ).iloc[0]
        latest_event = query(
            connection,
            "SELECT MAX(captured_at) AS captured_at FROM capture_events",
        ).iloc[0]["captured_at"]

        cols = st.columns(9)
        cols[0].metric("Known alliances", int(totals["alliances"]))
        cols[1].metric("Known players", int(totals["players"]))
        cols[2].metric("Alliance rankings", int(totals["ranking_snapshots"]))
        cols[3].metric("Member snapshots", int(totals["member_snapshots"]))
        cols[4].metric("Detailed profiles", int(totals["profiles"]))
        cols[5].metric("Arena snapshots", int(totals["arena_snapshots"]))
        cols[6].metric("Change events", int(totals["change_events"]))
        cols[7].metric("Pending refresh", int(totals["pending_refresh_jobs"]))
        cols[8].metric("Last capture", latest_event or "seed only")

        tabs = st.tabs(
            [
                "Refresh Center",
                "Overview",
                "Alliance",
                "Activity & Growth",
                "Monthly Pass",
                "Player",
                "Arena",
                "Changes",
                "Capture status",
            ]
        )
        with tabs[0]:
            render_refresh_center(connection)
        with tabs[1]:
            render_overview(connection)
        with tabs[2]:
            render_alliance(connection)
        with tabs[3]:
            render_activity(connection)
        with tabs[4]:
            render_monthly_pass(connection)
        with tabs[5]:
            render_player(connection)
        with tabs[6]:
            render_arena(connection)
        with tabs[7]:
            render_changes(connection)
        with tabs[8]:
            render_capture_status(connection)

        st.caption(
            f"Dashboard refreshed at "
            f"{dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}"
        )
    finally:
        connection.close()


render_dashboard()
