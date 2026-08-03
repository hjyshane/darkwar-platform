"""Bringing an old journal forward onto today's parsers.

The case this exists for is not hypothetical. A journal captured before
0025 and 0029 held 135 contribution rows and no arena lineups at all,
because those parsers did not exist when the observations arrived. The raw
payloads were right there the whole time and nothing could reach them.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from uuid import UUID

from typer.testing import CliRunner

from dw_collector.cli import app
from tests.conftest import load_observation

runner = CliRunner()


def _journal_with(tmp_path: Path, observations: list, *, rows: bool) -> Path:
    """A journal holding raw observations, with or without normalized rows —
    'without' standing in for a parser that did not exist yet."""
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.execute(
        "create table raw_observations (observation_id text primary key, collector_id text,"
        " source_command text, captured_at text, collected_from_server_id integer,"
        " payload_json text, created_at text)"
    )
    for observation in observations:
        connection.execute(
            "insert into raw_observations values (?, ?, ?, ?, ?, ?, ?)",
            (
                str(observation.observation_id),
                str(observation.collector_id),
                observation.source_command,
                observation.captured_at.isoformat(),
                observation.collected_from_server_id,
                json.dumps(observation.payload),
                observation.captured_at.isoformat(),
            ),
        )
    connection.commit()
    connection.close()
    return path


def test_rebuilds_rows_the_old_parser_never_made(tmp_path: Path) -> None:
    arena = load_observation("user.get.arena.info/top100_580v582_v1.json")
    source = _journal_with(tmp_path, [arena], rows=False)
    target = tmp_path / "new.db"

    result = runner.invoke(app, ["renormalize", "--source", str(source), "--db", str(target)])

    assert result.exit_code == 0, result.output
    assert "renormalized=1" in result.output

    rows = sqlite3.connect(target).execute(
        "select target_table, count(*) from normalized_rows group by target_table"
    )
    by_table = dict(rows)
    # The lineups are the point: a pre-0025 journal has none of these, and
    # they come out of the same payload it was already holding.
    assert by_table["arena_entry_heroes"] == 500
    assert by_table["arena_entries"] == 100


def test_leaves_the_source_untouched(tmp_path: Path) -> None:
    """Somebody's real capture history. A parser bug must not be able to eat
    it, so the source is opened read-only and written to never."""
    arena = load_observation("user.get.arena.info/top100_580v582_v1.json")
    source = _journal_with(tmp_path, [arena], rows=False)
    before = source.read_bytes()

    runner.invoke(app, ["renormalize", "--source", str(source), "--db", str(tmp_path / "new.db")])

    assert source.read_bytes() == before


def test_a_command_with_no_parser_is_not_a_failure(tmp_path: Path) -> None:
    """Most of a capture is commands nobody has written a parser for. They
    stay in the raw table as discovery input rather than stopping the run."""
    arena = load_observation("user.get.arena.info/top100_580v582_v1.json")
    unknown = arena.model_copy(
        update={
            "source_command": "some.command.nobody.parses",
            # Its own id: two rows in raw_observations, which is what the
            # source journal would really hold.
            "observation_id": UUID("00000000-0000-4000-8000-0000000000ff"),
        }
    )
    source = _journal_with(tmp_path, [arena, unknown], rows=False)

    result = runner.invoke(
        app, ["renormalize", "--source", str(source), "--db", str(tmp_path / "new.db")]
    )

    assert result.exit_code == 0
    assert "renormalized=1" in result.output
    assert "no-parser=1" in result.output


def test_running_it_twice_changes_nothing(tmp_path: Path) -> None:
    """Idempotency keys hash the raw payload, not the normalized row (§11.2),
    so the same observation reprocessed keeps its keys — which is what lets a
    renormalized journal be synced into a Supabase that already has the old
    rows without duplicating every one of them."""
    arena = load_observation("user.get.arena.info/top100_580v582_v1.json")
    source = _journal_with(tmp_path, [arena], rows=False)
    target = tmp_path / "new.db"

    runner.invoke(app, ["renormalize", "--source", str(source), "--db", str(target)])
    first = sqlite3.connect(target).execute("select count(*) from normalized_rows").fetchone()[0]
    runner.invoke(app, ["renormalize", "--source", str(source), "--db", str(target)])
    second = sqlite3.connect(target).execute("select count(*) from normalized_rows").fetchone()[0]

    assert first == second
