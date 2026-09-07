"""The settings a player edits instead of a `.env` file.

THE ENVIRONMENT STILL WINS. This repo is developed on a machine whose
collector is configured entirely by `DW_*` environment variables and a
`.env` at the repo root (`envfile.py`, which uses `os.environ.setdefault` for
exactly this reason: "Values already present in the environment always win,
so `dw-env.ps1`, CI secrets, and `uv run --env-file` keep overriding a stale
file"). A settings file that overrode the environment would silently change
what that machine's collector does the first time somebody opens the app on
it. So this module applies the file first and lets environment variables
overwrite whatever it produced, never the reverse.

No subprocesses and no HTTP here — this is the model and its file only. A
missing or corrupt file is not an error: the screen that would let a player
fix a bad settings file lives *inside* the app, so failing to parse one must
never be the reason the app refuses to open.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Everything the desktop app needs that used to live in `.env`.

    ALL FIELDS HAVE DEFAULTS. A first run has no file yet, and `load` must
    hand back something usable rather than raising — see the module
    docstring on why a bad or missing file can never block startup.
    """

    journal_path: str = ""
    capture_dir: str = ""
    #: An NPF device name (`\\Device\\NPF_{GUID}`), not a friendly adapter
    #: name — that is what `dumpcap -D` reports and what it accepts back.
    interface: str = ""
    dumpcap_path: str = ""
    server_id: int = 580
    game_port: int = 8680
    #: Not a credential — see `ensure_collector_id`. Empty until generated.
    collector_id: str = ""


#: Field names, used to filter a loaded file down to what this version knows
#: about. Splatting an arbitrary dict into the dataclass would raise
#: `TypeError` the day a newer version of the app adds a field.
_FIELD_NAMES = {f.name for f in fields(Settings)}


def load(path: Path, *, environ: Mapping[str, str]) -> Settings:
    """The file, then the environment on top of it — never the other way.

    `environ` IS A PARAMETER, NOT `os.environ` READ DIRECTLY. A test (or a
    caller) that mutates the real environment would leak into every load
    that runs after it; taking it as an argument keeps this function's
    answer a pure function of its inputs.

    THE FIELDS ARE APPLIED ONE BY ONE, NOT VIA A SPLATTED DICT. A dict of
    mixed `str | int` values loses the per-field type that `replace` needs
    to check under `mypy --strict`; naming each field keeps the string
    fields strings and the int field an int, all the way through.

    Each environment variable below is verified against the code that
    actually reads it, not guessed: `DW_SQLITE_PATH` in `cli.py`,
    `DW_CAPTURE_DIR` in `console/__main__.py`, `DW_CAPTURE_NPF_DEVICE` in
    `scripts/windows/register-tasks.ps1`, and `DW_COLLECTOR_SERVER_ID` /
    `DW_COLLECTOR_ID` in `capture/__main__.py`.
    """
    value = _from_file(path)
    journal_path = environ.get("DW_SQLITE_PATH", value.journal_path)
    capture_dir = environ.get("DW_CAPTURE_DIR", value.capture_dir)
    interface = environ.get("DW_CAPTURE_NPF_DEVICE", value.interface)
    collector_id = environ.get("DW_COLLECTOR_ID", value.collector_id)
    server_id = _int_env(environ, "DW_COLLECTOR_SERVER_ID", value.server_id)
    return replace(
        value,
        journal_path=journal_path,
        capture_dir=capture_dir,
        interface=interface,
        collector_id=collector_id,
        server_id=server_id,
    )


def _int_env(environ: Mapping[str, str], name: str, default: int) -> int:
    """`environ[name]` as an int, or `default` when absent or unparseable.

    A TYPO IN A HAND-EDITED `.env` MUST NOT TAKE THE WINDOW DOWN.
    `DW_COLLECTOR_SERVER_ID` is a string until something parses it, and the
    machine that later runs the packaged app has no console to show a
    traceback in.
    """
    raw = environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _from_file(path: Path) -> Settings:
    """`Settings` from disk, or the defaults when that is not possible.

    BOTH "missing" AND "unparseable" fall back the same way. A missing file
    is the ordinary first-run case; a corrupt one could come from a crash
    mid-write or a player's hand-edit — neither is a reason to refuse to
    start, per the module docstring.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return Settings()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return Settings()
    if not isinstance(data, dict):
        return Settings()
    # Filtered to known fields so a file written by a later version (with a
    # field this version has never heard of) does not blow up TypeError.
    known = {key: value for key, value in data.items() if key in _FIELD_NAMES}
    try:
        return Settings(**known)
    except TypeError:
        # A known key holding the wrong shape (e.g. server_id as a list)
        # still must not take the app down.
        return Settings()


def save(path: Path, value: Settings) -> None:
    """Write `value` as JSON, creating the parent directory if needed.

    The app's data directory may not exist yet on a first run — this is the
    only place that decides to create it, so callers never have to.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(value), indent=2), encoding="utf-8")


def ensure_collector_id(path: Path) -> str:
    """The persisted collector id, generating and saving one if there is none.

    NOT A CREDENTIAL: it is one of five components hashed into the unique
    `idempotency_key` (see `models.py`), so it only has to be a valid UUID
    and it only has to stop changing. Generating a new one on every launch
    would re-key the dedup history against itself on every restart.
    """
    current = _from_file(path)
    if current.collector_id:
        return current.collector_id
    generated = str(uuid.uuid4())
    save(path, replace(current, collector_id=generated))
    return generated
