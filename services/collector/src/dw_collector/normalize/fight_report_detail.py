"""get.fight.report.detail → battle_report_ingests (report_kind='detail').

Opening a received report asks the server for the full body. Like the mail
copy it is base64 protobuf with no available schema, so it is stored
undecoded for the same reason: the bodies expire, and a decoder written
later can only work on what was kept.

Measurably not a duplicate of the mail's copy — see migration 0014.

There is nothing here but the body. No mail uid, no sender, no recipient,
no timestamps; the response is `{_id, _time, contents}`. The row is
therefore "this report body was seen at this time", and the idempotency key
does the rest: it hashes the raw payload, so re-opening the same report
does not stack up copies.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.registry import register

PARSER_VERSION = "1.0.0"


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow")

    contents: str


@register("get.fight.report.detail")
def normalize(observation: Observation) -> list[NormalizedRow]:
    payload = _Payload.model_validate(observation.payload)
    if not payload.contents:
        # An empty body is not a report. Recording it would put a row with
        # nothing in it between a future decoder and the real ones.
        return []
    bucket = observation.captured_at.date().isoformat()
    return [
        NormalizedRow(
            target_table="battle_report_ingests",
            idempotency_key=idempotency_key(observation, "fight-report-detail", bucket),
            row={
                "observation_id": str(observation.observation_id),
                "source_command": observation.source_command,
                "parser_version": PARSER_VERSION,
                "captured_at": observation.captured_at.isoformat(),
                "collector_id": str(observation.collector_id),
                "collected_from_server_id": observation.collected_from_server_id,
                "raw": {},
                "report_kind": "detail",
                "report_content": payload.contents,
            },
        )
    ]
