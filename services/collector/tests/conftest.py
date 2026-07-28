from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

import dw_collector.normalize  # noqa: F401  (registers normalizers)
from dw_collector.models import Observation
from dw_collector.storage.journal import Journal

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "protocol-fixtures"


def load_observation(relative: str) -> Observation:
    path = FIXTURES / "decoded" / relative
    return Observation.model_validate(json.loads(path.read_text()))


@pytest.fixture
def journal(tmp_path: Path) -> Iterator[Journal]:
    j = Journal(tmp_path / "journal.db")
    j.init_db()
    yield j
    j.close()
