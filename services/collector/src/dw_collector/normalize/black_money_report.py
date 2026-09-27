"""chat.get.system.mails → black_money_score_snapshots.

The per-player Black Money scores exist in one place: the battle report
the game mails to every participant a few minutes after the battle. It is
system mail type 147. Every other type in the inbox is ignored here.

The report's body is a JSON STRING (`contentsLocal`). Its `obj.scoreInfo`
holds both sides of the battle, and each side's `userArr` lists every
player who ENTERED with their uid, total score and its five parts. So the
list is the team's actual turnout: 21 players for team B today, where
dragon.battle.history said userNum 21.

The same battle reaches every participant under a different mail uid. The
capture is machine-wide, so two of our accounts opening their inboxes put
the same report into the journal twice — it has already happened, for the
09-13 team A battle. The key is therefore the report's content, not the
mail, and the second copy lands on the first one's key.

Both sides are kept. The opponent's players are real players on real
servers, and the report is the only place their scores appear.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.normalize.black_money_signup import home_server
from dw_collector.registry import register

log = structlog.get_logger()

PARSER_VERSION = "1.0.0"
REPORT_MAIL_TYPE = 147


class _Player(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    name: str | None = None
    score: int | None = None
    kill_score: int | None = Field(default=None, alias="killScore")
    occupy_score: int | None = Field(default=None, alias="occupyScore")
    first_occupy_score: int | None = Field(default=None, alias="firstOccupyScore")
    collect_score: int | None = Field(default=None, alias="collectScore")
    escort_score: int | None = Field(default=None, alias="escortScore")

    @field_validator("uid")
    @classmethod
    def _numeric_uid(cls, value: str) -> str:
        if not value.isdigit():
            msg = f"uid must be a numeric string, got {value!r}"
            raise ValueError(msg)
        return value


class _Side(BaseModel):
    model_config = ConfigDict(extra="allow")

    alliance_id: str = Field(alias="allianceId")
    server_id: int | None = Field(default=None, alias="serverId")
    name: str | None = None
    abbr: str | None = None
    side: int | None = None
    win: int | None = None
    players: list[_Player] = Field(alias="userArr")


class _Report(BaseModel):
    model_config = ConfigDict(extra="allow")

    sides: list[_Side] = Field(alias="scoreInfo")


class _Body(BaseModel):
    model_config = ConfigDict(extra="allow")

    obj: dict[str, Any]


class _Mail(BaseModel):
    model_config = ConfigDict(extra="allow")

    uid: str
    type: int
    send_time: int = Field(alias="sendTime")
    contents: str = Field(alias="contentsLocal")


class _Page(BaseModel):
    model_config = ConfigDict(extra="allow")

    mails: list[dict[str, Any]] = Field(default_factory=list, alias="msg")


@register("chat.get.system.mails")
def normalize(observation: Observation) -> list[NormalizedRow]:
    page = _Page.model_validate(observation.payload)
    rows: list[NormalizedRow] = []
    for raw_mail in page.mails:
        if raw_mail.get("type") != REPORT_MAIL_TYPE:
            continue
        # A bad report is skipped, not raised. This command is the whole
        # system inbox, and ingest journals nothing for an observation whose
        # normalizer raises — then deletes the pcap. One odd type-147 mail
        # would otherwise take the raw page, and every good report on it,
        # with it. The page is still journaled raw, so a fixed parser can
        # replay the skipped report later.
        try:
            rows.extend(_report_rows(observation, _Mail.model_validate(raw_mail)))
        except ValidationError as exc:
            log.warning(
                "black_money_report.skipped",
                mail_uid=raw_mail.get("uid"),
                errors=exc.error_count(),
            )
    return rows


def _report_rows(observation: Observation, mail: _Mail) -> list[NormalizedRow]:
    # Parsed through a model so a body that is not JSON, or has no report in
    # it, fails the way every other malformed payload does.
    raw_report = _Body.model_validate_json(mail.contents).obj
    report = _Report.model_validate(raw_report)
    reported_at = datetime.fromtimestamp(mail.send_time / 1000, tz=UTC).isoformat()
    # The hash covers the WHOLE report, deliberately, not each player's own
    # entry. A player's entry does not name its battle: a substitute who
    # entered and scored nothing can send an identical entry in two
    # different events, and hashing only the entry would file the second
    # event onto the first one's key and drop it. The report is what
    # identifies the battle, and a sent report never changes, so nothing is
    # lost by every player's key sharing it. `scoreInfo` only — `obj` also
    # names the RECIPIENT's alliance, which is not part of the battle.
    report_hash_basis = {"scoreInfo": raw_report.get("scoreInfo")}

    rows: list[NormalizedRow] = []
    for side, raw_side in zip(report.sides, raw_report["scoreInfo"], strict=True):
        for player, raw_player in zip(side.players, raw_side["userArr"], strict=True):
            game_uid = int(player.uid)
            server_id = home_server(
                player.uid, side.server_id, observation.collected_from_server_id
            )
            key = entry_idempotency_key(
                observation,
                f"report:{game_uid}",
                side.alliance_id,
                report_hash_basis,
            )
            rows.append(
                NormalizedRow(
                    target_table="black_money_score_snapshots",
                    idempotency_key=key,
                    row={
                        "observation_id": str(observation.observation_id),
                        "source_command": observation.source_command,
                        "parser_version": PARSER_VERSION,
                        "captured_at": observation.captured_at.isoformat(),
                        "collector_id": str(observation.collector_id),
                        "collected_from_server_id": observation.collected_from_server_id,
                        "raw": raw_player,
                        "snapshot_id": str(stable_uuid(key)),
                        "server_id": server_id,
                        "game_uid": game_uid,
                        "name": player.name,
                        "alliance_external_id": side.alliance_id,
                        "alliance_abbr": side.abbr or None,
                        "side": side.side,
                        "win": side.win,
                        "reported_at": reported_at,
                        "score": player.score,
                        "kill_score": player.kill_score,
                        "occupy_score": player.occupy_score,
                        "first_occupy_score": player.first_occupy_score,
                        "collect_score": player.collect_score,
                        "escort_score": player.escort_score,
                    },
                    entity_refs={
                        "player": {
                            "game_uid": game_uid,
                            "server_id": server_id,
                            "name": player.name,
                        },
                        "alliance": {
                            "server_id": side.server_id or server_id,
                            "external_id": side.alliance_id,
                            "name": side.name,
                            "code": side.abbr,
                        },
                    },
                )
            )
    return rows
