"""Load a `.env` file into the process environment.

The repo ships `.env.example`, which implies `.env` works — but nothing
read it, so every entrypoint silently ran with missing configuration and
reported "required" or, worse, fell back to a default journal path and
synced nothing. This closes that gap.

Hand-rolled rather than pulling in python-dotenv: the collector has four
runtime dependencies and this is a dozen lines of parsing. Values already
present in the environment always win, so `dw-env.ps1`, CI secrets, and
`uv run --env-file` keep overriding a stale file.
"""

from __future__ import annotations

import os
from pathlib import Path

MAX_PARENTS = 4


def find_env_file(start: Path | None = None) -> Path | None:
    """`$DW_ENV_FILE`, else the nearest `.env` at or above the directory.

    Walking up matters because the collector is normally run from
    `services/collector` while `.env` sits at the repo root.
    """
    explicit = os.environ.get("DW_ENV_FILE")
    if explicit:
        candidate = Path(explicit)
        return candidate if candidate.is_file() else None

    directory = (start or Path.cwd()).resolve()
    for parent in [directory, *directory.parents][: MAX_PARENTS + 1]:
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
    return None


def parse_env_file(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        key, separator, value = line.partition("=")
        if not separator:
            continue
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            # Unquoted values may carry a trailing comment.
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def load_env_file(path: Path | None = None, *, start: Path | None = None) -> Path | None:
    """Populate os.environ from a .env file; returns the file used, if any.

    Never overwrites a variable that is already set.
    """
    env_path = path or find_env_file(start)
    if env_path is None or not env_path.is_file():
        return None
    for key, value in parse_env_file(env_path.read_text(encoding="utf-8")).items():
        os.environ.setdefault(key, value)
    return env_path
