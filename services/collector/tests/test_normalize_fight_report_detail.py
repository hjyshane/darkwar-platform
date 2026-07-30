"""get.fight.report.detail — the opened report, kept undecoded."""

from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import fight_report_detail, mail_read_share
from tests.conftest import load_observation

FIXTURE = "get.fight.report.detail/opened_report_580_v1.json"


def test_registered() -> None:
    assert registry.get("get.fight.report.detail") is fight_report_detail.normalize


def test_the_opened_body_is_stored_undecoded() -> None:
    observation = load_observation(FIXTURE)
    rows = fight_report_detail.normalize(observation)

    assert len(rows) == 1
    row = rows[0].row
    assert rows[0].target_table == "battle_report_ingests"
    assert row["report_kind"] == "detail"
    content = row["report_content"]
    assert isinstance(content, str) and content
    base64.b64decode(content + "=" * (-len(content) % 4))


def test_it_carries_no_mail_identity() -> None:
    """The response is {_id, _time, contents} — inventing a sender or a
    recipient to fill the columns would be fabrication."""
    row = fight_report_detail.normalize(load_observation(FIXTURE))[0].row

    assert "mail_uid" not in row
    assert "from_game_uid" not in row
    assert "to_game_uid" not in row


def test_the_two_report_kinds_are_distinguishable() -> None:
    """Both parsers write one table; report_kind is what says which body a
    row holds, rather than leaving it to be guessed from null columns."""
    detail = fight_report_detail.normalize(load_observation(FIXTURE))[0].row
    mail = mail_read_share.normalize(load_observation("mail.read.share/battle_report_580_v1.json"))[
        0
    ].row

    assert detail["report_kind"] == "detail"
    assert mail["report_kind"] == "mail_simple"
    assert detail["report_content"] != mail["report_content"]


def test_an_empty_body_is_not_a_report() -> None:
    observation = load_observation(FIXTURE)
    empty = observation.model_copy(update={"payload": {"contents": ""}})

    assert fight_report_detail.normalize(empty) == []


def test_missing_contents_is_rejected() -> None:
    observation = load_observation(FIXTURE)
    with pytest.raises(ValidationError):
        fight_report_detail.normalize(observation.model_copy(update={"payload": {}}))


def test_reopening_the_same_report_does_not_stack_copies() -> None:
    observation = load_observation(FIXTURE)
    first = fight_report_detail.normalize(observation)[0].idempotency_key
    second = fight_report_detail.normalize(observation)[0].idempotency_key

    assert first == second


def test_key_survives_a_parser_version_bump() -> None:
    observation = load_observation(FIXTURE)
    before = fight_report_detail.normalize(observation)[0].idempotency_key

    original = fight_report_detail.PARSER_VERSION
    fight_report_detail.PARSER_VERSION = "9.9.9"
    try:
        after = fight_report_detail.normalize(observation)[0].idempotency_key
    finally:
        fight_report_detail.PARSER_VERSION = original

    assert before == after


def test_fixture_body_is_truncated() -> None:
    observation = load_observation(FIXTURE)

    assert len(observation.payload["contents"]) <= 64
