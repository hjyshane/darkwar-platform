"""Every promoted parser owns a fixture (NFR-009).

This lives outside test_sync_live.py on purpose. The live module is marked
`supabase` and skips wholesale without a local stack, which is exactly the
situation in CI's python job — and this check needs no database, only the
registry and the fixture tree. Keeping it here means CI catches a parser
promoted without a fixture instead of finding out on someone's laptop.
"""

from __future__ import annotations

from pathlib import Path

from dw_collector import registry
from tests.conftest import FIXTURES


def healthy_fixtures(command: str) -> list[Path]:
    """Every fixture for a command except the deliberately broken ones.

    `*_malformed_*` fixtures exist to prove the parser rejects them, so they
    do not count as coverage for a delivery path.
    """
    directory = FIXTURES / "decoded" / command
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.glob("*.json") if "_malformed_" not in p.name)


def test_every_promoted_parser_has_a_fixture() -> None:
    missing = sorted(c for c in registry.known_commands() if not healthy_fixtures(c))

    assert missing == [], f"promoted parsers with no usable fixture: {missing}"


def test_no_orphan_fixture_directories() -> None:
    """The reverse drift: a fixture tree for a command nothing parses any
    more. Harmless on its own, but it is how a directory outlives the parser
    that justified it and starts looking like coverage that does not exist."""
    directories = {p.name for p in (FIXTURES / "decoded").iterdir() if p.is_dir()}

    assert directories == set(registry.known_commands())
