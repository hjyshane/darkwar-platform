"""The settings a player edits instead of a .env file.

THE ENVIRONMENT STILL WINS, and that is not a detail. This repo is developed
on a machine whose collector is configured entirely by environment variables
and a .env at the repo root; a settings file that overrode them would change
what that machine does the first time somebody opens the app on it.
"""

from __future__ import annotations

import json
from pathlib import Path

from dw_collector.desktop import settings


def test_defaults_stand_in_for_a_file_that_does_not_exist_yet(
    tmp_path: Path,
) -> None:
    # First run. Nothing should explode, and nothing should be written just
    # by asking what the settings are.
    loaded = settings.load(tmp_path / "settings.json", environ={})
    assert loaded.game_port == 8680
    assert loaded.server_id == 580
    assert not (tmp_path / "settings.json").exists()


def test_a_saved_file_is_read_back(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    settings.save(path, settings.Settings(server_id=581, capture_dir="C:/caps"))
    loaded = settings.load(path, environ={})
    assert loaded.server_id == 581
    assert loaded.capture_dir == "C:/caps"


def test_the_environment_beats_the_file(tmp_path: Path) -> None:
    """The machine this repo is developed on is configured by environment,
    and opening the app on it must not quietly reconfigure the collector."""
    path = tmp_path / "settings.json"
    settings.save(path, settings.Settings(server_id=581, capture_dir="C:/from-file"))
    loaded = settings.load(
        path,
        environ={"DW_COLLECTOR_SERVER_ID": "584", "DW_CAPTURE_DIR": "C:/from-env"},
    )
    assert loaded.server_id == 584
    assert loaded.capture_dir == "C:/from-env"


def test_a_collector_id_is_generated_once_and_then_kept(tmp_path: Path) -> None:
    """It is not a credential — it is one of five components hashed into the
    unique idempotency key, so it only has to be a UUID and it only has to
    stop changing. A new one every launch would re-key the dedup history."""
    path = tmp_path / "settings.json"
    first = settings.ensure_collector_id(path)
    second = settings.ensure_collector_id(path)
    assert first == second
    assert len(first) == 36
    # And it was actually persisted, not just returned.
    assert json.loads(path.read_text(encoding="utf-8"))["collector_id"] == first


def test_a_corrupt_file_falls_back_rather_than_refusing_to_start(
    tmp_path: Path,
) -> None:
    """A settings file nobody can parse must not be the reason the app will
    not open — the screen that fixes it is inside the app."""
    path = tmp_path / "settings.json"
    path.write_text("{ this is not json", encoding="utf-8")
    loaded = settings.load(path, environ={})
    assert loaded.game_port == 8680


def test_an_unknown_key_in_the_file_is_ignored(tmp_path: Path) -> None:
    # A file written by a later version must not stop an earlier one.
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"server_id": 581, "invented_later": True}), encoding="utf-8")
    assert settings.load(path, environ={}).server_id == 581


def test_a_non_numeric_environment_value_does_not_take_the_app_down(
    tmp_path: Path,
) -> None:
    """DW_COLLECTOR_SERVER_ID is a string until something parses it, and a
    typo in a .env must not be the reason a window will not open."""
    loaded = settings.load(
        tmp_path / "settings.json", environ={"DW_COLLECTOR_SERVER_ID": "not-a-number"}
    )
    assert loaded.server_id == 580


def test_a_file_that_parses_but_holds_the_wrong_types_falls_back(
    tmp_path: Path,
) -> None:
    """A FILE THAT PARSES IS NOT A FILE THAT IS USABLE.

    Dataclasses do not check types, so `{"server_id": "581"}` would sail
    through as a string and only fail later, inside a capture argument,
    a long way from the file that caused it.
    """
    path = tmp_path / "settings.json"
    path.write_text(
        json.dumps({"server_id": "581", "game_port": None, "capture_dir": 7}),
        encoding="utf-8",
    )
    loaded = settings.load(path, environ={})
    assert loaded.server_id == 580
    assert loaded.game_port == 8680
    assert loaded.capture_dir == ""


def test_a_good_value_beside_a_bad_one_still_survives(tmp_path: Path) -> None:
    # Falling back must be per field, not "throw the whole file away".
    path = tmp_path / "settings.json"
    path.write_text(
        json.dumps({"server_id": "nonsense", "capture_dir": "C:/keep-me"}),
        encoding="utf-8",
    )
    loaded = settings.load(path, environ={})
    assert loaded.server_id == 580
    assert loaded.capture_dir == "C:/keep-me"


def test_the_capture_port_can_come_from_the_environment(tmp_path: Path) -> None:
    # DW_CAPTURE_PORT already exists and is read by capture/__main__.py; a
    # settings file that ignored it would disagree with the collector this
    # repo already runs.
    loaded = settings.load(tmp_path / "settings.json", environ={"DW_CAPTURE_PORT": "9001"})
    assert loaded.game_port == 9001
