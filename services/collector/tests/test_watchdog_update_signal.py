from dw_collector.watchdog.update_signal import UpdateObserver


def test_first_version_is_baseline_then_change_signals() -> None:
    obs = UpdateObserver()
    assert obs.observe("a", {"a": {"client_version": "1.2"}}) == []
    assert obs.observe("a", {"a": {"client_version": "1.2"}}) == []
    (sig,) = obs.observe("a", {"a": {"client_version": "1.3"}})
    assert sig.kind == "version_changed"
    assert sig.detail == "client_version 1.2 -> 1.3"


def test_unrelated_keys_and_bools_are_ignored() -> None:
    obs = UpdateObserver()
    assert obs.observe("a", {"versioned": 1, "version": True}) == []
    assert obs.observe("a", {"versioned": 2, "version": False}) == []


def test_push_names_signal_without_reading_payload() -> None:
    obs = UpdateObserver()
    (sig,) = obs.observe("push.kick.player", None)
    assert sig.kind == "push_signal"
    assert obs.observe("push.utc.time", {}) == []


def test_repeated_login_is_flagged_unless_we_restarted() -> None:
    obs = UpdateObserver()
    assert obs.observe("init", {}) == []
    (sig,) = obs.observe("init", {})
    assert sig.kind == "login_repeated"
    obs.restarted()
    assert obs.observe("init", {}) == []
