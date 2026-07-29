from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.idle_detection import get_idle_state


def main() -> int:
    state = get_idle_state(300)
    assert isinstance(state.is_idle, bool)
    assert state.idle_seconds >= 0
    assert state.reason
    print("idle detection regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
