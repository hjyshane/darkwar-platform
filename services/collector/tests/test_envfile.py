"""`.env` loading — the repo ships .env.example, so .env must work."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from dw_collector.envfile import find_env_file, load_env_file, parse_env_file


def test_parses_comments_quotes_and_export() -> None:
    parsed = parse_env_file(
        """
        # a comment

        SUPABASE_URL=http://127.0.0.1:54321
        export DW_COLLECTOR_SERVER_ID=580
        QUOTED="value with spaces"
        SINGLE='single quoted'
        WINDOWS_PATH=C:\\DW_data\\collector.db
        TRAILING=value # inline comment
        EMPTY=
        NOT_A_PAIR
        """
    )
    assert parsed == {
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "DW_COLLECTOR_SERVER_ID": "580",
        "QUOTED": "value with spaces",
        "SINGLE": "single quoted",
        "WINDOWS_PATH": "C:\\DW_data\\collector.db",
        "TRAILING": "value",
        "EMPTY": "",
    }


def test_hash_inside_a_quoted_value_is_kept() -> None:
    assert parse_env_file('KEY="a#b"') == {"KEY": "a#b"}


def test_load_populates_environ(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DW_ENV_FILE", raising=False)
    (tmp_path / ".env").write_text("DW_TEST_LOADED=yes\n")
    monkeypatch.delenv("DW_TEST_LOADED", raising=False)

    used = load_env_file(start=tmp_path)
    assert used == tmp_path / ".env"
    assert os.environ["DW_TEST_LOADED"] == "yes"


def test_existing_environment_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """dw-env.ps1, CI secrets, and uv --env-file must beat a stale file."""
    monkeypatch.delenv("DW_ENV_FILE", raising=False)
    (tmp_path / ".env").write_text("DW_TEST_PRECEDENCE=from-file\n")
    monkeypatch.setenv("DW_TEST_PRECEDENCE", "from-shell")

    load_env_file(start=tmp_path)
    assert os.environ["DW_TEST_PRECEDENCE"] == "from-shell"


def test_finds_env_in_a_parent_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The collector is run from services/collector; .env sits at the root."""
    monkeypatch.delenv("DW_ENV_FILE", raising=False)
    (tmp_path / ".env").write_text("DW_TEST_PARENT=yes\n")
    nested = tmp_path / "services" / "collector"
    nested.mkdir(parents=True)

    assert find_env_file(nested) == tmp_path / ".env"


def test_explicit_env_file_overrides_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text("DW_TEST_X=discovered\n")
    chosen = tmp_path / "custom.env"
    chosen.write_text("DW_TEST_X=chosen\n")
    monkeypatch.setenv("DW_ENV_FILE", str(chosen))

    assert find_env_file(tmp_path) == chosen


def test_missing_file_is_not_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DW_ENV_FILE", raising=False)
    assert load_env_file(start=tmp_path) is None
