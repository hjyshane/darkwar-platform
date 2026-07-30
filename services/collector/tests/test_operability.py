"""Operator commands, added because the workarounds they replace were being
typed by hand — and one of them (syncing the wrong journal) looked exactly
like success."""

from __future__ import annotations

from datetime import UTC, datetime

from typer.testing import CliRunner

from dw_collector.cli import app
from dw_collector.normalize import al_rank
from dw_collector.storage.journal import Journal
from tests.conftest import load_observation

runner = CliRunner()


def _load(journal: Journal) -> None:
    observation = load_observation("al.rank/cbfw_roster_v1.json")
    journal.record(observation, al_rank.normalize(observation))


def test_journal_summary_reports_what_is_there(journal: Journal) -> None:
    _load(journal)
    result = runner.invoke(app, ["journal-summary", "--db", str(journal.path)])
    assert result.exit_code == 0
    assert str(journal.path) in result.output
    assert "al.rank" in result.output
    assert "alliance_member_snapshots" in result.output
    assert "93" in result.output


def test_journal_summary_on_an_empty_journal_says_so(tmp_path: object) -> None:
    from pathlib import Path

    assert isinstance(tmp_path, Path)
    result = runner.invoke(app, ["journal-summary", "--db", str(tmp_path / "empty.db")])
    assert result.exit_code == 0
    assert "outbox={}" in result.output


def test_retry_clears_backoff_without_touching_sent_rows(journal: Journal) -> None:
    _load(journal)
    ids = [item.id for item in journal.pending_outbox()]
    journal.mark_sent(ids[:10])
    journal.mark_failed(
        ids[10:20], "boom", max_attempts=99, base_backoff=3600.0, max_backoff=3600.0
    )

    # Backing off, so nothing is due.
    assert len(journal.pending_outbox()) == 73

    affected = journal.retry_outbox()
    assert affected == 83  # everything except the 10 sent
    assert len(journal.pending_outbox()) == 83
    assert journal.outbox_counts() == {"pending": 83, "sent": 10}


def test_retry_can_include_dead_letters(journal: Journal) -> None:
    _load(journal)
    ids = [item.id for item in journal.pending_outbox()]
    journal.mark_failed(ids, "boom", max_attempts=1, base_backoff=1.0, max_backoff=1.0)
    assert journal.outbox_counts() == {"dead_letter": 93}

    assert journal.retry_outbox() == 0, "dead letters stay put unless asked for"
    assert journal.retry_outbox(dead_letters=True) == 93
    assert journal.outbox_counts() == {"pending": 93}
    # The attempt counter resets, or the row would die again immediately.
    assert all(item.attempt_count == 0 for item in journal.pending_outbox(limit=200))


def test_retry_can_resend_after_the_cloud_was_reset(journal: Journal) -> None:
    """supabase db reset empties the cloud while the journal still knows it
    sent everything. Resending is safe: the cloud-side unique key absorbs it."""
    _load(journal)
    journal.mark_sent([item.id for item in journal.pending_outbox()])
    assert journal.outbox_counts() == {"sent": 93}

    assert journal.retry_outbox(already_sent=True) == 93
    assert journal.outbox_counts() == {"pending": 93}


def test_sync_prints_the_journal_it_used(journal: Journal) -> None:
    """Syncing an empty journal in the wrong checkout reports sent=0 and looks
    identical to having nothing to send, so the path goes in the output."""
    result = runner.invoke(
        app,
        [
            "sync",
            "--db",
            str(journal.path),
            "--url",
            "http://127.0.0.1:9",
            "--secret-key",
            "not-used",
        ],
    )
    assert f"journal={journal.path}" in result.output


def test_discovery_rows_ask_the_database_to_merge(journal: Journal) -> None:
    """seen_count can only be maintained where the row's history is known, so
    discovery rows must arrive as an UPDATE on conflict, not be ignored."""
    from dw_collector.discovery import discovery_row
    from dw_collector.models import Observation

    observation = Observation(
        observation_id=__import__("uuid").uuid4(),
        collector_id=__import__("uuid").UUID("00000000-0000-4000-8000-00000000c777"),
        source_command="get.battlepass.info",
        captured_at=datetime.now(tz=UTC),
        collected_from_server_id=580,
        payload={"season": 3},
    )
    row = discovery_row(observation)
    assert row.conflict_target != "idempotency_key"
