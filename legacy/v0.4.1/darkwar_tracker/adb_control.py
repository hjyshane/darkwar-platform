from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Iterable


class AdbError(RuntimeError):
    pass


COMMON_ADB_PATHS = (
    Path(r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe"),
    Path(r"C:\Program Files\BlueStacks\HD-Adb.exe"),
    Path(r"C:\Program Files (x86)\BlueStacks_nxt\HD-Adb.exe"),
    Path(r"C:\Program Files (x86)\BlueStacks\HD-Adb.exe"),
)

COMMON_BLUESTACKS_SERIALS = tuple(
    f"127.0.0.1:{port}" for port in range(5555, 5565)
)


@dataclass(frozen=True)
class TapStep:
    label: str
    x: int
    y: int
    wait_seconds: float | None = None


@dataclass(frozen=True)
class TapSequence:
    version: int
    recorded_width: int
    recorded_height: int
    steps: tuple[TapStep, ...]


def resolve_adb_path(explicit: str | None = None) -> Path:
    if explicit:
        path = Path(os.path.expandvars(os.path.expanduser(explicit)))
        if path.is_file():
            return path
        raise AdbError(f"Configured adb executable was not found: {path}")

    for command in ("adb", "HD-Adb.exe", "HD-Adb"):
        found = shutil.which(command)
        if found:
            return Path(found)

    if sys.platform == "win32":
        for path in COMMON_ADB_PATHS:
            if path.is_file():
                return path

    raise AdbError(
        "ADB was not found. Enable BlueStacks Android Debug Bridge and "
        "set refresh_automation.adb_path in config.toml when necessary."
    )


class AdbClient:
    def __init__(
        self,
        adb_path: str | Path,
        device_serial: str | None = None,
    ) -> None:
        self.adb_path = Path(adb_path)
        self.device_serial = device_serial

    def _command(self, args: Iterable[str]) -> list[str]:
        command = [str(self.adb_path)]
        if self.device_serial:
            command.extend(["-s", self.device_serial])
        command.extend(str(value) for value in args)
        return command

    def run(
        self,
        args: Iterable[str],
        *,
        timeout: float = 30,
        check: bool = True,
        binary: bool = False,
    ) -> subprocess.CompletedProcess[Any]:
        process = subprocess.run(
            self._command(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
            text=not binary,
        )
        if check and process.returncode != 0:
            stderr = (
                process.stderr.decode("utf-8", "replace")
                if binary and isinstance(process.stderr, bytes)
                else str(process.stderr)
            ).strip()
            raise AdbError(
                f"ADB command failed ({process.returncode}): "
                f"{' '.join(self._command(args))}\n{stderr}"
            )
        return process

    def list_devices(self) -> list[str]:
        process = subprocess.run(
            [str(self.adb_path), "devices"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
            check=False,
            text=True,
        )
        if process.returncode != 0:
            raise AdbError(process.stderr.strip() or "adb devices failed")

        devices: list[str] = []
        for line in process.stdout.splitlines()[1:]:
            fields = line.strip().split()
            if len(fields) >= 2 and fields[1] == "device":
                devices.append(fields[0])
        return devices

    def connect(self, serial: str) -> bool:
        process = subprocess.run(
            [str(self.adb_path), "connect", serial],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
            text=True,
        )
        output = f"{process.stdout}\n{process.stderr}".lower()
        return process.returncode == 0 and (
            "connected" in output or "already connected" in output
        )

    def ensure_device(self) -> str:
        devices = self.list_devices()

        if self.device_serial:
            if self.device_serial not in devices:
                self.connect(self.device_serial)
                devices = self.list_devices()
            if self.device_serial not in devices:
                raise AdbError(
                    f"Configured device is not connected: {self.device_serial}"
                )
            return self.device_serial

        if len(devices) == 1:
            self.device_serial = devices[0]
            return devices[0]

        if not devices:
            for serial in COMMON_BLUESTACKS_SERIALS:
                if self.connect(serial):
                    devices = self.list_devices()
                    if serial in devices:
                        self.device_serial = serial
                        return serial

        if len(devices) > 1:
            raise AdbError(
                "Multiple ADB devices are connected. Set "
                "refresh_automation.device_serial in config.toml.\n"
                + "\n".join(f"- {value}" for value in devices)
            )

        raise AdbError(
            "No BlueStacks ADB device was found. Enable ADB in BlueStacks "
            "Settings > Advanced and restart BlueStacks."
        )

    def shell(self, *args: str, timeout: float = 30) -> str:
        return str(
            self.run(["shell", *args], timeout=timeout).stdout
        ).strip()

    def launch_package(self, package: str, *, force_stop: bool = True) -> None:
        if force_stop:
            self.shell("am", "force-stop", package)
        process = self.run(
            [
                "shell",
                "monkey",
                "-p",
                package,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ],
            timeout=30,
            check=False,
        )
        output = f"{process.stdout}\n{process.stderr}"
        if process.returncode != 0 or "No activities found" in output:
            raise AdbError(
                f"Unable to launch Android package {package}: {output.strip()}"
            )

    def tap(self, x: int, y: int) -> None:
        self.shell("input", "tap", str(int(x)), str(int(y)))

    def keyevent(self, keycode: int) -> None:
        self.shell("input", "keyevent", str(int(keycode)))

    def screenshot_png(self) -> bytes:
        process = self.run(
            ["exec-out", "screencap", "-p"],
            timeout=30,
            binary=True,
        )
        if not isinstance(process.stdout, bytes) or not process.stdout:
            raise AdbError("BlueStacks screenshot was empty")
        return process.stdout

    def screen_size(self) -> tuple[int, int]:
        output = self.shell("wm", "size")
        for line in output.splitlines():
            if "Physical size:" in line or "Override size:" in line:
                value = line.split(":", 1)[1].strip()
                width, height = value.split("x", 1)
                return int(width), int(height)
        raise AdbError(f"Unable to parse device screen size: {output}")


def load_tap_sequence(path: str | Path) -> TapSequence:
    sequence_path = Path(path)
    if not sequence_path.is_file():
        raise AdbError(
            f"Refresh tap sequence was not found: {sequence_path}. "
            "Run calibrate_refresh.bat first."
        )

    with sequence_path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)

    screen = raw.get("screen_size") or {}
    steps_raw = raw.get("steps") or []
    steps = tuple(
        TapStep(
            label=str(item.get("label") or f"Step {index + 1}"),
            x=int(item["x"]),
            y=int(item["y"]),
            wait_seconds=(
                float(item["wait_seconds"])
                if item.get("wait_seconds") is not None
                else None
            ),
        )
        for index, item in enumerate(steps_raw)
    )
    if not steps:
        raise AdbError("Refresh tap sequence contains no steps")

    return TapSequence(
        version=int(raw.get("version", 1)),
        recorded_width=int(screen["width"]),
        recorded_height=int(screen["height"]),
        steps=steps,
    )


def scaled_tap(
    step: TapStep,
    sequence: TapSequence,
    current_width: int,
    current_height: int,
) -> tuple[int, int]:
    if sequence.recorded_width <= 0 or sequence.recorded_height <= 0:
        raise AdbError("Invalid recorded screen dimensions")
    x = round(step.x * current_width / sequence.recorded_width)
    y = round(step.y * current_height / sequence.recorded_height)
    return x, y
