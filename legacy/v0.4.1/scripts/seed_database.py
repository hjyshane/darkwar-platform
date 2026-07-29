from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from darkwar_tracker.database import Database


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_member_payload(
    alliance_id: str,
    rank_names: dict,
    members: list[dict],
) -> dict:
    normalized = []

    for member in members:
        if "player_name" in member:
            normalized.append({
                "uid": member.get("player_uid"),
                "name": member.get("player_name"),
                "serverId": member.get("server_id"),
                "curServerId": member.get("current_server_id"),
                "power": member.get("power"),
                "mainCityLv": member.get("hq_level"),
                "rank": member.get("alliance_rank"),
                "online": member.get("online_raw"),
                "offLineTime": member.get("offline_time_raw"),
                "pointId": member.get("point_id"),
                "armyKill": member.get("army_kill"),
                "careerType": member.get("career_type"),
                "careerLv": member.get("career_level"),
                "careerPos": member.get("career_position"),
                "sex": member.get("sex"),
                "pic": member.get("profile_picture"),
                "picVer": member.get("profile_picture_version"),
                "headSkinId": member.get("head_skin_id"),
                "alsign": member.get("alliance_sign"),
            })
        else:
            normalized.append({
                "uid": member.get("player_uid"),
                "name": member.get("name"),
                "serverId": member.get("server_id"),
                "curServerId": member.get("current_server_id"),
                "power": member.get("power"),
                "mainCityLv": member.get("hq_level"),
                "rank": member.get("alliance_rank"),
                "online": member.get("online"),
                "offLineTime": member.get("offline_time_ms"),
                "pointId": member.get("point_id"),
                "armyKill": member.get("army_kill"),
                "careerType": member.get("career_type"),
                "careerLv": member.get("career_level"),
                "careerPos": member.get("career_position"),
                "sex": member.get("sex"),
                "pic": member.get("profile_picture"),
                "picVer": member.get("profile_picture_version"),
                "headSkinId": member.get("head_skin_id"),
                "headSkinET": member.get("head_skin_expiry_ms"),
                "monthCardEndTime": member.get("month_card_expiry_s"),
                "alsign": member.get("alliance_sign"),
            })

    return {
        "allianceId": alliance_id,
        "rankName": rank_names,
        "list": normalized,
        "allianceOfficialArr": [],
    }


def main() -> None:
    database_path = PROJECT_ROOT / "data" / "darkwar.sqlite3"
    if database_path.exists():
        database_path.unlink()

    db = Database(database_path, top_n=3)
    timestamp = now()

    try:
        ranking_seed = json.loads(
            (PROJECT_ROOT / "seed" / "cross_server_top100.json")
            .read_text(encoding="utf-8")
        )
        ranking_payload = {
            **ranking_seed.get("request", {}),
            "allianceRanking": ranking_seed["alliance_ranking"],
        }
        db.save_ranking_snapshot(ranking_payload, timestamp)

        cbfw = json.loads(
            (PROJECT_ROOT / "seed" / "cbfw_members.json")
            .read_text(encoding="utf-8")
        )
        db.save_alliance_info(
            {
                "uid": cbfw["alliance_id"],
                "createServer": 580,
                "abbr": "CBFW",
                "name": "Tempest",
                "leaderName": "☆Morrighan☆",
                "country": "UN",
                "maxMember": 100,
                "curMember": cbfw["member_count"],
                "fightPower": sum(
                    int(member.get("power") or 0)
                    for member in cbfw["members"]
                ),
            },
            timestamp,
        )
        db.save_member_snapshot(
            normalize_member_payload(
                cbfw["alliance_id"],
                cbfw.get("rank_names", {}),
                cbfw["members"],
            ),
            timestamp,
        )

        love = json.loads(
            (PROJECT_ROOT / "seed" / "love_members.json")
            .read_text(encoding="utf-8")
        )
        db.save_alliance_info(love["alliance_info_raw"], timestamp)
        db.save_member_snapshot(
            normalize_member_payload(
                love["summary"]["alliance_id"],
                love.get("rank_names", {}),
                love["members"],
            ),
            timestamp,
        )

        print(f"Seeded database: {database_path}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
