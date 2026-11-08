"""running -> stalled / update_detected -> relaunch -> relogin, with a brake.

ADR-0002 allows a client restart when a packet-level signal asks for one, on
condition that restarts back off, are counted, are announced, and stop after
repeated failure. This is that rule and nothing else: it owns no process, no
clock and no device. Time, the packet probe, the signal source, the two device
actions and the alert sink are all injected, so every branch is tested without
sleeping or touching an emulator.

The cost of being wrong is the collector account, which can be rate-limited or
banned for behaving like a bot. So a failed recovery is never retried at once,
and the loop ends in HALTED rather than trying forever. HALTED is left only by
`resume()`, i.e. by a person.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal, Protocol

import structlog

from dw_collector.watchdog.update_signal import UpdateSignal

log = structlog.get_logger()


class State(StrEnum):
    RUNNING = "running"
    STALLED = "stalled"
    UPDATE_DETECTED = "update_detected"
    HALTED = "halted"


AlertKind = Literal[
    "stalled", "update_signal", "restarted", "recovered", "relogin_failed", "halted"
]


@dataclass(frozen=True)
class Alert:
    kind: AlertKind
    detail: str


class GameClient(Protocol):
    def relaunch(self) -> bool:
        """Force-stop and start the game. True once the launch was delivered."""
        ...

    def relogin(self) -> bool:
        """Run the cold-start routine. True only if the login response arrived."""
        ...


@dataclass(frozen=True)
class WatchdogConfig:
    #: No packet for this long, while the client should be running, is a stall.
    #: Far below `data_stalled` (2 h) on purpose: the watchdog acts first and
    #: the cloud alert stays the backstop for when it has halted.
    stall_after: timedelta = timedelta(minutes=10)
    #: After a restart, how long to wait for a packet before calling it failed.
    verify_within: timedelta = timedelta(minutes=5)
    backoff_min: timedelta = timedelta(minutes=2)
    backoff_max: timedelta = timedelta(minutes=30)
    #: At most this many restarts in `budget_window`, however well they went.
    max_restarts: int = 6
    budget_window: timedelta = timedelta(hours=6)
    #: This many failed recoveries in a row halt the loop.
    max_consecutive_failures: int = 3
    #: Off until a real update signal has been seen and matched to a rule.
    auto_restart_on_signal: bool = False


class Watchdog:
    def __init__(
        self,
        config: WatchdogConfig,
        client: GameClient,
        *,
        last_packet_at: Callable[[], datetime | None],
        signals: Callable[[], list[UpdateSignal]],
        now: Callable[[], datetime],
        alert: Callable[[Alert], None],
        on_restart: Callable[[], None] | None = None,
        fatal: tuple[type[Exception], ...] = (),
    ) -> None:
        self._cfg = config
        self._client = client
        self._last_packet_at = last_packet_at
        self._signals = signals
        self._now = now
        self._alert = alert
        self._on_restart = on_restart
        # Raised by a client call, these are not a failed recovery to back off
        # from: a guard refusing the target means the target is wrong.
        self._fatal = fatal
        self.state = State.RUNNING
        self._since = now()
        self._restarts: deque[datetime] = deque()
        self._failures = 0
        self._next_attempt: datetime | None = None
        self._verify_from: datetime | None = None
        self._pending_signal: UpdateSignal | None = None
        self._announced_stall = False

    @property
    def restarts_in_window(self) -> int:
        return len(self._restarts)

    def resume(self) -> None:
        """A person looked at it. Clears the failure count and the budget."""
        self._failures = 0
        self._restarts.clear()
        self._next_attempt = None
        self._verify_from = None
        self._pending_signal = None
        self._announced_stall = False
        self._since = self._now()
        self.state = State.RUNNING

    def halt_now(self, why: str) -> None:
        """Start (or stay) halted, e.g. when a halt marker survived a restart."""
        self.state = State.HALTED
        self._verify_from = None
        log.error("watchdog.halted", why=why)

    def tick(self) -> State:
        if self.state is State.HALTED:
            return self.state
        now = self._now()
        for signal in self._signals():
            self._alert(Alert("update_signal", f"{signal.kind}: {signal.detail}"))
            if self._cfg.auto_restart_on_signal and self._pending_signal is None:
                self._pending_signal = signal
        if self._verify_from is not None and self._check_recovery(now):
            return self.state
        if self._verify_from is not None:
            return self.state
        if self._pending_signal is not None:
            self.state = State.UPDATE_DETECTED
            self._attempt(now, f"update signal ({self._pending_signal.detail})")
        elif self._stalled(now):
            if not self._announced_stall:
                self._announced_stall = True
                self._alert(Alert("stalled", f"no packet for {self._cfg.stall_after}"))
            self.state = State.STALLED
            self._attempt(now, "stalled")
        else:
            self.state = State.RUNNING
            self._announced_stall = False
        return self.state

    def _stalled(self, now: datetime) -> bool:
        last = self._last_packet_at()
        return now - (last or self._since) >= self._cfg.stall_after

    def _check_recovery(self, now: datetime) -> bool:
        """True when the pending restart was settled this tick."""
        assert self._verify_from is not None
        last = self._last_packet_at()
        if last is not None and last > self._verify_from:
            self._verify_from = None
            self._failures = 0
            self._next_attempt = None
            self._announced_stall = False
            self.state = State.RUNNING
            self._alert(Alert("recovered", "packets are flowing again"))
            return True
        if now - self._verify_from >= self._cfg.verify_within:
            self._verify_from = None
            self._fail(now, "no packet after restart")
            return True
        return False

    def _attempt(self, now: datetime, reason: str) -> None:
        if self._next_attempt is not None and now < self._next_attempt:
            return
        while self._restarts and now - self._restarts[0] > self._cfg.budget_window:
            self._restarts.popleft()
        if len(self._restarts) >= self._cfg.max_restarts:
            self._halt(f"{len(self._restarts)} restarts in {self._cfg.budget_window}: {reason}")
            return
        self._restarts.append(now)
        self._pending_signal = None
        self._alert(
            Alert("restarted", f"{reason}; attempt {len(self._restarts)}/{self._cfg.max_restarts}")
        )
        if self._on_restart is not None:
            self._on_restart()
        try:
            launched = self._client.relaunch()
        except self._fatal:
            raise
        except Exception as exc:
            log.warning("watchdog.relaunch_error", error=str(exc))
            launched = False
        if not launched:
            self._fail(now, "relaunch failed")
            return
        try:
            logged_in = self._client.relogin()
        except self._fatal:
            raise
        except Exception as exc:
            log.warning("watchdog.relogin_error", error=str(exc))
            logged_in = False
        if not logged_in:
            self._alert(Alert("relogin_failed", "login response did not arrive"))
            self._fail(now, "relogin failed")
            return
        self._verify_from = now

    def _fail(self, now: datetime, why: str) -> None:
        self._failures += 1
        if self._failures >= self._cfg.max_consecutive_failures:
            self._halt(f"{self._failures} failed recoveries in a row: {why}")
            return
        backoff = min(
            self._cfg.backoff_min * 2 ** (self._failures - 1),
            self._cfg.backoff_max,
        )
        self._next_attempt = now + backoff
        self.state = State.STALLED
        log.warning("watchdog.recovery_failed", why=why, retry_in=str(backoff))

    def _halt(self, why: str) -> None:
        self.state = State.HALTED
        self._verify_from = None
        self._alert(Alert("halted", why))
        log.error("watchdog.halted", why=why)
