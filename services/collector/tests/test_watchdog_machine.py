from __future__ import annotations

from datetime import UTC, datetime, timedelta

from dw_collector.watchdog.machine import Alert, State, Watchdog, WatchdogConfig
from dw_collector.watchdog.update_signal import UpdateSignal

T0 = datetime(2026, 11, 4, tzinfo=UTC)


class FakeClient:
    def __init__(self, launch: bool = True, login: bool = True) -> None:
        self.launch_ok, self.login_ok = launch, login
        self.launches = 0
        self.logins = 0

    def relaunch(self) -> bool:
        self.launches += 1
        return self.launch_ok

    def relogin(self) -> bool:
        self.logins += 1
        return self.login_ok


class Rig:
    def __init__(self, client: FakeClient | None = None, **cfg: object) -> None:
        self.t = T0
        self.last: datetime | None = T0
        self.sigs: list[UpdateSignal] = []
        self.alerts: list[Alert] = []
        self.client = client or FakeClient()
        self.restarts = 0
        self.dog = Watchdog(
            WatchdogConfig(**cfg),  # type: ignore[arg-type]
            self.client,
            last_packet_at=lambda: self.last,
            signals=self._drain,
            now=lambda: self.t,
            alert=self.alerts.append,
            on_restart=self._count,
        )

    def _count(self) -> None:
        self.restarts += 1

    def _drain(self) -> list[UpdateSignal]:
        out, self.sigs = self.sigs, []
        return out

    def advance(self, **kw: float) -> State:
        self.t += timedelta(**kw)
        return self.dog.tick()

    def kinds(self) -> list[str]:
        return [a.kind for a in self.alerts]


def test_healthy_stream_never_restarts() -> None:
    r = Rig()
    for _ in range(20):
        r.last = r.t
        assert r.advance(minutes=1) is State.RUNNING
    assert r.client.launches == 0


def test_stall_restarts_then_recovers() -> None:
    r = Rig()
    assert r.advance(minutes=10) is State.STALLED
    assert (r.client.launches, r.client.logins, r.restarts) == (1, 1, 1)
    r.last = r.t + timedelta(seconds=30)
    r.advance(minutes=1)
    assert r.dog.state is State.RUNNING
    assert r.kinds() == ["stalled", "restarted", "recovered"]


def test_no_packet_after_restart_backs_off_exponentially() -> None:
    r = Rig(max_consecutive_failures=5)
    r.advance(minutes=10)  # restart 1
    r.advance(minutes=5)  # verify window expires -> fail 1, wait 2 min
    r.advance(minutes=1)
    assert r.client.launches == 1
    r.advance(minutes=1)  # 2 min elapsed -> restart 2
    assert r.client.launches == 2
    r.advance(minutes=5)  # fail 2, wait 4 min
    r.advance(minutes=3)
    assert r.client.launches == 2
    r.advance(minutes=1)
    assert r.client.launches == 3


def test_repeated_failures_halt_and_stay_halted() -> None:
    r = Rig(FakeClient(login=False), max_consecutive_failures=3, backoff_min=timedelta(0))
    for _ in range(6):
        r.advance(minutes=10)
    assert r.dog.state is State.HALTED
    assert r.client.launches == 3
    assert r.kinds().count("halted") == 1
    assert r.kinds().count("relogin_failed") == 3
    r.advance(hours=5)
    assert r.client.launches == 3


def test_relaunch_failure_counts_as_failure() -> None:
    r = Rig(FakeClient(launch=False), max_consecutive_failures=1)
    r.advance(minutes=10)
    assert r.dog.state is State.HALTED
    assert r.client.logins == 0


def test_exceptions_from_client_do_not_escape() -> None:
    class Boom(FakeClient):
        def relaunch(self) -> bool:
            raise OSError("adb gone")

    r = Rig(Boom(), max_consecutive_failures=2)
    r.advance(minutes=10)
    assert r.dog.state is State.STALLED


def test_restart_budget_halts_even_when_restarts_succeed() -> None:
    r = Rig(max_restarts=2, budget_window=timedelta(hours=6))
    for _ in range(2):
        r.advance(minutes=10)  # stall -> restart
        r.last = r.t + timedelta(seconds=1)
        r.advance(minutes=1)  # recovered
    r.advance(minutes=10)
    assert r.dog.state is State.HALTED
    assert "restart" in r.alerts[-1].detail


def test_budget_window_forgets_old_restarts() -> None:
    r = Rig(max_restarts=1, budget_window=timedelta(hours=1))
    r.advance(minutes=10)
    r.last = r.t + timedelta(seconds=1)
    r.advance(minutes=1)
    r.last = None
    r.advance(hours=2)
    assert r.dog.state is State.STALLED
    assert r.client.launches == 2


def test_resume_clears_halt() -> None:
    r = Rig(FakeClient(launch=False), max_consecutive_failures=1)
    r.advance(minutes=10)
    r.dog.resume()
    assert r.dog.state is State.RUNNING
    assert r.dog.restarts_in_window == 0


def test_signal_alerts_but_does_not_restart_by_default() -> None:
    r = Rig()
    r.sigs = [UpdateSignal("version_changed", "k", "ver 1 -> 2")]
    r.last = r.t
    r.advance(minutes=1)
    assert r.kinds() == ["update_signal"]
    assert r.client.launches == 0


def test_signal_restarts_when_enabled() -> None:
    r = Rig(auto_restart_on_signal=True)
    r.sigs = [UpdateSignal("push_signal", "k", "push.kick")]
    r.last = r.t
    r.advance(minutes=1)
    assert r.client.launches == 1
    assert r.kinds() == ["update_signal", "restarted"]


def test_silent_from_start_counts_as_stall() -> None:
    r = Rig()
    r.last = None
    assert r.advance(minutes=9) is State.RUNNING
    assert r.advance(minutes=2) is State.STALLED
