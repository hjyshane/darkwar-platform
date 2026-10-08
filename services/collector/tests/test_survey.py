"""The backfill survey: what a journal already holds that no parser reads.

Every payload here is hand-written. The roster is three members; the lead is
an unparsed board naming two of them; the mail page is read twice, as the
inbox is, and must count once.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from typer.testing import CliRunner

from dw_collector.cli import app
from dw_collector.models import Observation
from dw_collector.storage.journal import Journal
from dw_collector.survey import Survey, iter_journal, render_report, write_samples

COLLECTOR = uuid.UUID("00000000-0000-4000-8000-0000000c5e01")
T0 = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)

OURS = "a" * 32
THEIRS = "b" * 32
M1, M2, M3 = "9101000000000580", "9102000000000580", "9103000000000580"
STRANGER = "9999000000000581"


def _roster(alliance: str, uids: list[str]) -> dict[str, Any]:
    return {"allianceId": alliance, "list": [{"uid": u, "name": f"P{u[:4]}"} for u in uids]}


SIEGE = {
    "actId": 7,
    "rankList": [
        {"uid": M1, "score": 900},
        {"uid": M2, "score": 0},
        {"uid": STRANGER, "score": 50},
    ],
    # Not uids: too short, and a key that does not name one.
    "selfUid": 5,
    "points": 9101000000000580,
}

FRANKY_MAIL = {
    "uid": "mail-1",
    "type": 211,
    "sendTime": 1758369600000,
    "contentsLocal": json.dumps(
        {"title": "Frankie event top 10", "rank": [{"ownerUid": M3, "damage": 12}]}
    ),
}

BLACK_GOLD_MAIL = {"uid": "mail-2", "type": 147, "sendTime": 1758369600000, "contentsLocal": "{}"}


def _observations() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("al.rank", _roster(OURS, [M1, M2, M3])),
        ("al.rank", _roster(OURS, [M1, M2, M3])),
        ("al.rank", _roster(THEIRS, [STRANGER])),
        ("monster.siege.reward.info", SIEGE),
        ("al.battle.rank.info", {"type": 1, "list": [{"uid": M1, "score": 1}]}),
        ("chat.get.system.mails", {"msg": [FRANKY_MAIL, BLACK_GOLD_MAIL]}),
        # The same inbox page, read again a minute later.
        ("chat.get.system.mails", {"msg": [FRANKY_MAIL, BLACK_GOLD_MAIL]}),
    ]


def _journal(path: Path) -> Path:
    journal = Journal(path)
    journal.init_db()
    for index, (command, payload) in enumerate(_observations()):
        digest = hashlib.sha256(f"{index}{command}".encode()).hexdigest()
        journal.record(
            Observation(
                observation_id=uuid.UUID(digest[:32]),
                collector_id=COLLECTOR,
                source_command=command,
                captured_at=T0 + timedelta(minutes=index),
                collected_from_server_id=580,
                payload=payload,
            ),
            [],
        )
    journal.close()
    return path


def _survey(path: Path, **kwargs: Any) -> Survey:
    survey = Survey(**kwargs)
    for command, at, text in iter_journal(path):
        survey.add(command, at, text)
    return survey


def test_the_roster_is_the_most_read_alliance(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    alliance, roster, _ = survey.roster()
    assert alliance == OURS
    assert roster == frozenset({M1, M2, M3})


def test_an_unparsed_board_naming_our_members_is_a_lead(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    _, roster, _ = survey.roster()
    leads = {lead.source.name: lead for lead in survey.leads(roster)}
    siege = leads["monster.siege.reward.info"]
    assert siege.members_named == 2
    assert siege.best_path == "$.rankList[]"
    assert siege.best_path_members == 2
    assert siege.best_path_len == 3


def test_short_numbers_and_non_uid_keys_are_not_uids(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    siege = survey.sources["monster.siege.reward.info"]
    assert siege.uids == {M1, M2, STRANGER}


def test_parsed_commands_are_counted_and_never_leads(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    _, roster, _ = survey.roster()
    names = {lead.source.name for lead in survey.leads(roster)}
    assert "al.battle.rank.info" not in names
    assert survey.sources["al.battle.rank.info"].count == 1
    assert survey.sources["al.battle.rank.info"].analysed == 0


def test_mail_types_are_sources_of_their_own_and_a_reread_page_counts_once(
    tmp_path: Path,
) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    franky = survey.sources["mail:type=211"]
    assert franky.count == 1
    assert not franky.known
    assert survey.sources["mail:type=147"].known


def test_a_mail_body_inside_a_string_is_walked(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    franky = survey.sources["mail:type=211"]
    assert M3 in franky.uids
    assert "$.contentsLocal{json}.rank[]" in franky.lists
    assert franky.keywords["frank"] == 1


def test_the_report_flags_leads_and_never_prints_a_uid(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"))
    report = render_report(survey, inputs=["j.db"], lead_threshold=2)
    assert "**LEAD** `monster.siege.reward.info`" in report
    assert "**LEAD** `mail:type=211`" not in report  # one member, under the bar
    for uid in (M1, M2, M3, STRANGER):
        assert uid not in report


def test_samples_are_written_only_for_unparsed_sources(tmp_path: Path) -> None:
    survey = _survey(_journal(tmp_path / "j.db"), samples_per_source=2)
    written = write_samples(survey, tmp_path / "samples")
    names = sorted(p.name for p in (tmp_path / "samples").iterdir())
    assert written == len(names)
    assert any(name.startswith("monster.siege.reward.info.") for name in names)
    assert not any(name.startswith("al.battle.rank.info") for name in names)
    assert not any("147" in name for name in names)


def test_the_journal_is_opened_read_only(tmp_path: Path) -> None:
    path = _journal(tmp_path / "j.db")
    before = path.stat().st_mtime_ns, path.stat().st_size
    list(iter_journal(path))
    assert (path.stat().st_mtime_ns, path.stat().st_size) == before


def test_the_cli_writes_the_report(tmp_path: Path) -> None:
    path = _journal(tmp_path / "j.db")
    out = tmp_path / "out" / "survey.md"
    result = CliRunner().invoke(app, ["survey", "--journal", str(path), "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert "monster.siege.reward.info" in out.read_text(encoding="utf-8")


def test_the_cli_wants_something_to_read(tmp_path: Path) -> None:
    result = CliRunner().invoke(app, ["survey", "--out", str(tmp_path / "x.md")])
    assert result.exit_code != 0


def test_a_capture_is_decoded_by_the_collectors_own_decoder(tmp_path: Path) -> None:
    from tests.test_capture_formats import PORT, _ethernet, _ipv4, _pcapng, _tcp
    from tests.test_protocol import frame

    def body(command: str, payload: dict[str, Any]) -> bytes:
        return frame({"a": 13, "c": 1, "p": {"c": command, "p": payload}})

    # One stream: the second segment's sequence follows the first's payload.
    roster_body = body("al.rank", _roster(OURS, [M1, M2, M3]))
    siege_body = body("monster.siege.reward.info", SIEGE)
    first = _ethernet(_ipv4(_tcp(roster_body, sport=PORT, seq=1)))
    second = _ethernet(_ipv4(_tcp(siege_body, sport=PORT, seq=1 + len(roster_body))))
    captures = tmp_path / "captures"
    captures.mkdir()
    (captures / "walk.pcapng").write_bytes(_pcapng([(0, first), (0, second)], [1]))

    out = tmp_path / "survey.md"
    result = CliRunner().invoke(app, ["survey", "--pcap", str(captures), "--out", str(out)])
    assert result.exit_code == 0, result.output
    report = out.read_text(encoding="utf-8")
    assert "**LEAD**" not in report  # two members, under the default bar of five
    assert "| `monster.siege.reward.info` | 1 |" in report
    assert "3 members" in report
