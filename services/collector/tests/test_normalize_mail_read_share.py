"""mail.read.share — keep the report now, decode it later."""

from __future__ import annotations

import base64
import copy
import json

import pytest
from pydantic import ValidationError

from dw_collector import registry
from dw_collector.normalize import mail_read_share
from tests.conftest import load_observation

FIXTURE = "mail.read.share/battle_report_580_v1.json"


def test_registered() -> None:
    assert registry.get("mail.read.share") is mail_read_share.normalize


def test_report_mail_is_stored_undecoded() -> None:
    observation = load_observation(FIXTURE)
    rows = mail_read_share.normalize(observation)

    assert len(rows) == 1
    row = rows[0].row
    assert rows[0].target_table == "battle_report_ingests"
    assert row["mail_type"] == 72
    assert row["mail_uid"] == "9175367513003731"
    # Base64 that is not decoded here on purpose: the body is protobuf with no
    # known schema. Storing it verbatim is what makes a later decoder able to
    # work on months of history instead of starting from an empty table.
    content = row["report_content"]
    assert isinstance(content, str) and content
    base64.b64decode(content + "=" * (-len(content) % 4))
    assert row["report_marker"] == {
        "c": {"battleReportSimple": {"fightReportSimple": [{"selfType": 1, "otherType": 7}]}}
    }


def test_sender_is_absent_and_stays_absent() -> None:
    """The observed report mails are system-generated: fromUser/fromName are
    empty strings. Writing 0 or the empty string into a uid column would
    invent a player, so an absent sender stays null."""
    row = mail_read_share.normalize(load_observation(FIXTURE))[0].row

    assert row["from_game_uid"] is None
    # toUser is the mail's recipient — a different player than the collector,
    # because this mail was SHARED and then read. Which side of the battle
    # that player was on is not established, so it is kept as a uid and not
    # resolved to a player row.
    assert row["to_game_uid"] == 9111364514000629


def test_timestamps_convert_from_epoch_millis() -> None:
    row = mail_read_share.normalize(load_observation(FIXTURE))[0].row

    assert row["sent_at"] == "2026-07-25T22:08:21.228000+00:00"
    assert row["expires_at"] == "2026-08-24T22:08:21.228000+00:00"


def test_mail_without_the_marker_is_skipped() -> None:
    """The same response also carries alliance and system mail. Nothing about
    those belongs in a battle-report table."""
    observation = load_observation(FIXTURE)
    payload = copy.deepcopy(observation.payload)
    payload["msg"][0]["custom"] = '{"c":{}}'
    plain = observation.model_copy(update={"payload": payload})

    assert mail_read_share.normalize(plain) == []


def test_empty_mailbox_yields_no_rows() -> None:
    observation = load_observation(FIXTURE)
    empty = observation.model_copy(update={"payload": {"msg": []}})

    assert mail_read_share.normalize(empty) == []


def test_marker_without_a_body_still_records_the_sighting() -> None:
    """A truncated or unparseable contentsLocal loses the report body, but the
    fact that a report arrived — and from whom, and when — is still worth
    keeping; that is the row that tells us a capture was missed."""
    observation = load_observation(FIXTURE)
    payload = copy.deepcopy(observation.payload)
    payload["msg"][0]["contentsLocal"] = "not json"
    rows = mail_read_share.normalize(observation.model_copy(update={"payload": payload}))

    assert len(rows) == 1
    assert rows[0].row["report_content"] is None
    assert rows[0].row["mail_uid"] == "9175367513003731"


def test_missing_msg_is_rejected() -> None:
    observation = load_observation(FIXTURE)
    with pytest.raises(ValidationError):
        mail_read_share.normalize(observation.model_copy(update={"payload": {}}))


def test_replay_is_idempotent() -> None:
    observation = load_observation(FIXTURE)
    first = mail_read_share.normalize(observation)
    second = mail_read_share.normalize(observation)

    assert [r.idempotency_key for r in first] == [r.idempotency_key for r in second]


def test_key_survives_a_parser_version_bump() -> None:
    """Pinned repo-wide: the key hashes the raw payload, so bumping the parser
    must not duplicate every report already stored."""
    observation = load_observation(FIXTURE)
    before = mail_read_share.normalize(observation)[0].idempotency_key

    original = mail_read_share.PARSER_VERSION
    mail_read_share.PARSER_VERSION = "9.9.9"
    try:
        after = mail_read_share.normalize(observation)[0].idempotency_key
    finally:
        mail_read_share.PARSER_VERSION = original

    assert before == after


def test_fixture_body_is_truncated() -> None:
    """The sanitizer keeps only the first characters of battleContent: the
    real body is another player's full army composition and does not belong
    in the repo."""
    observation = load_observation(FIXTURE)
    body = json.loads(observation.payload["msg"][0]["contentsLocal"])

    assert len(body["obj"]["battleContent"]) <= 64
