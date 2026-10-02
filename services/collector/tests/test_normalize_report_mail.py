"""Scout and battle report mails kept undecoded in battle_report_ingests.

Hand-authored mails: a real report body names other players' troops and
uids inside protobuf, which the fixture sanitizers cannot reach. The bodies
here are stand-in strings — the parser stores them, it never reads them.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from dw_collector import pipeline
from dw_collector.models import Observation
from dw_collector.normalize import black_money_report, report_mail

SCOUT_BODY = "CgYIARIC" + "QUJD" * 8
BATTLE_BODY = "EIPd2wVGa" + "WFla" * 8


def _mail(mail_type: int, body_key: str | None, body: str, **extra: Any) -> dict[str, Any]:
    contents = {"b": {}, "obj": {body_key: body}} if body_key else {"b": {}, "obj": {}}
    return {
        "uid": f"mail-{mail_type}-{len(body)}",
        "type": mail_type,
        "fromUser": "",
        "toUser": "9123456789000580",
        "sendTime": 1790949649635,
        "expireTime": 1791554449635,
        "contentsLocal": json.dumps(contents),
        **extra,
    }


def _observation(command: str, payload: dict[str, Any]) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
        source_command=command,
        captured_at=datetime(2026, 10, 2, 21, 40, 16, tzinfo=UTC),
        collected_from_server_id=580,
        payload=payload,
    )


def _inbox(*mails: dict[str, Any]) -> Observation:
    return _observation("chat.get.system.mails", {"msg": list(mails)})


def test_a_scout_result_is_kept_as_scout() -> None:
    (row,) = black_money_report.normalize(_inbox(_mail(8, "scoutContent", SCOUT_BODY)))

    assert row.target_table == "battle_report_ingests"
    assert row.row["report_kind"] == "scout"
    assert row.row["report_content"] == SCOUT_BODY
    assert row.row["mail_type"] == 8
    assert row.row["to_game_uid"] == 9123456789000580
    assert row.row["from_game_uid"] is None


def test_a_battle_report_is_kept_as_mail_simple() -> None:
    """mail_simple is what mail.read.share writes for the same body."""
    (row,) = black_money_report.normalize(_inbox(_mail(72, "battleContent", BATTLE_BODY)))

    assert row.row["report_kind"] == "mail_simple"
    assert row.row["report_content"] == BATTLE_BODY
    assert row.row["sent_at"] == "2026-10-02T14:00:49.635000+00:00"


def test_an_unlisted_report_type_is_kept_by_its_body() -> None:
    """Routing is by body key, so a new report type is not silently lost."""
    (row,) = report_mail.ingest_rows(_inbox(), _mail(999, "battleContent", BATTLE_BODY))

    assert row.row["mail_type"] == 999


def test_ordinary_mail_writes_nothing() -> None:
    rows = black_money_report.normalize(
        _inbox(_mail(3, None, ""), {"uid": "x", "type": 13, "contentsLocal": "plain text"})
    )

    assert rows == []


def test_a_malformed_body_writes_nothing() -> None:
    broken = {**_mail(72, "battleContent", BATTLE_BODY), "contentsLocal": "{not json"}
    assert report_mail.ingest_rows(_inbox(), broken) == []
    empty = _mail(72, "battleContent", "")
    assert report_mail.ingest_rows(_inbox(), empty) == []


def test_raw_is_the_mail_without_its_body() -> None:
    (row,) = black_money_report.normalize(_inbox(_mail(8, "scoutContent", SCOUT_BODY)))

    assert "contentsLocal" not in row.row["raw"]
    assert row.row["raw"]["type"] == 8


def test_pushed_and_fetched_copies_share_a_key() -> None:
    """The same report reaches us pushed, on an inbox page, and under another
    recipient's mail uid. All of them are one report."""
    mail = _mail(72, "battleContent", BATTLE_BODY)
    (fetched,) = black_money_report.normalize(_inbox(mail))
    (pushed,) = black_money_report.normalize_pushed(_observation("push.mail", mail))
    other_recipient = {**mail, "uid": "another-mail-uid", "toUser": "9000000000001580"}
    (copy,) = black_money_report.normalize(_inbox(other_recipient))

    assert fetched.idempotency_key == pushed.idempotency_key == copy.idempotency_key
    assert fetched.row["ingest_id"] == pushed.row["ingest_id"]


def test_different_reports_get_different_keys() -> None:
    (a,) = black_money_report.normalize(_inbox(_mail(72, "battleContent", BATTLE_BODY)))
    (b,) = black_money_report.normalize(_inbox(_mail(72, "battleContent", BATTLE_BODY + "QQ")))
    (s,) = black_money_report.normalize(_inbox(_mail(8, "scoutContent", BATTLE_BODY)))

    assert len({a.idempotency_key, b.idempotency_key, s.idempotency_key}) == 3


def test_one_page_keeps_every_report_on_it() -> None:
    rows = black_money_report.normalize(
        _inbox(
            _mail(8, "scoutContent", SCOUT_BODY),
            _mail(3, None, ""),
            _mail(109, "battleContent", BATTLE_BODY),
        )
    )

    assert sorted(r.row["report_kind"] for r in rows) == ["mail_simple", "scout"]


def test_no_activity_facts() -> None:
    rows = pipeline.process(_inbox(_mail(8, "scoutContent", SCOUT_BODY)))

    assert {r.target_table for r in rows} == {"battle_report_ingests"}
