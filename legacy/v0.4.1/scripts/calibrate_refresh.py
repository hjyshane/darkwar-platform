from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import tempfile
import time
import tkinter as tk
from tkinter import messagebox, ttk

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.adb_control import AdbClient, AdbError, resolve_adb_path
from darkwar_tracker.config import load_config
from darkwar_tracker.refresh_control import WORKFLOW_LABELS

CALIBRATABLE = (
    "full_weekly_ui",
    "rankings",
    "my_alliance",
    "tracked_alliances",
)


class RefreshCalibrator:
    def __init__(self, config_path: Path, workflow_id: str) -> None:
        self.config_path = config_path
        self.config = load_config(config_path)
        self.workflow_id = workflow_id
        refresh = self.config.refresh_automation
        adb_path = resolve_adb_path(refresh.adb_path)
        self.adb = AdbClient(adb_path, refresh.device_serial)
        self.serial = self.adb.ensure_device()
        self.screen_width, self.screen_height = self.adb.screen_size()
        self.steps: list[dict[str, object]] = []
        self.selected: tuple[int, int] | None = None
        self.scale = 1
        self.photo: tk.PhotoImage | None = None

        label = WORKFLOW_LABELS[workflow_id]
        self.root = tk.Tk()
        self.root.title(f"DarkWar Refresh Calibration · {label}")
        self.root.geometry("1250x850")

        self.status = tk.StringVar(
            value=(
                f"Dark War를 재시작한 뒤 {label} 갱신 경로를 기록합니다. "
                "화면에서 다음 버튼을 클릭하고 ‘좌표 저장 후 실행’을 "
                "누르세요. 필요한 데이터 화면을 모두 연 뒤 완료합니다."
            )
        )
        self.label_value = tk.StringVar(value=f"{label} 단계 1")
        self.coordinate_value = tk.StringVar(value="선택 좌표: 없음")

        top = ttk.Frame(self.root, padding=10)
        top.pack(fill="x")
        ttk.Label(top, textvariable=self.status, wraplength=1180).pack(
            anchor="w"
        )

        controls = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        controls.pack(fill="x")
        ttk.Label(controls, text="단계 이름").grid(row=0, column=0, sticky="w")
        ttk.Entry(
            controls,
            textvariable=self.label_value,
            width=45,
        ).grid(row=0, column=1, padx=8, sticky="ew")
        ttk.Label(
            controls,
            textvariable=self.coordinate_value,
        ).grid(row=0, column=2, padx=8)
        controls.columnconfigure(1, weight=1)

        button_row = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        button_row.pack(fill="x")
        ttk.Button(
            button_row,
            text="좌표 저장 후 실행",
            command=self.save_and_execute,
        ).pack(side="left", padx=4)
        ttk.Button(
            button_row,
            text="다시 캡처",
            command=self.refresh_screenshot,
        ).pack(side="left", padx=4)
        ttk.Button(
            button_row,
            text="Android 뒤로가기",
            command=self.go_back,
        ).pack(side="left", padx=4)
        ttk.Button(
            button_row,
            text="마지막 단계 제거",
            command=self.remove_last,
        ).pack(side="left", padx=4)
        ttk.Button(
            button_row,
            text="완료 및 저장",
            command=self.finish,
        ).pack(side="right", padx=4)

        self.canvas = tk.Canvas(
            self.root,
            background="black",
            highlightthickness=0,
        )
        self.canvas.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.canvas.bind("<Button-1>", self.select_coordinate)

    def launch(self) -> None:
        refresh = self.config.refresh_automation
        self.status.set(
            f"ADB 장치 {self.serial}에서 Dark War를 재시작하는 중입니다."
        )
        self.root.update_idletasks()
        self.adb.launch_package(refresh.package, force_stop=True)
        time.sleep(refresh.launch_wait_seconds)
        self.refresh_screenshot()
        self.root.mainloop()

    def refresh_screenshot(self) -> None:
        png = self.adb.screenshot_png()
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            handle.write(png)
            screenshot_path = Path(handle.name)
        try:
            original = tk.PhotoImage(file=str(screenshot_path))
        finally:
            screenshot_path.unlink(missing_ok=True)

        max_width = 1200
        max_height = 700
        self.scale = max(
            1,
            math.ceil(original.width() / max_width),
            math.ceil(original.height() / max_height),
        )
        self.photo = (
            original.subsample(self.scale, self.scale)
            if self.scale > 1
            else original
        )
        self.canvas.delete("all")
        self.canvas.config(
            width=self.photo.width(),
            height=self.photo.height(),
            scrollregion=(0, 0, self.photo.width(), self.photo.height()),
        )
        self.canvas.create_image(0, 0, image=self.photo, anchor="nw")
        self.selected = None
        self.coordinate_value.set("선택 좌표: 없음")

    def select_coordinate(self, event: tk.Event[tk.Misc]) -> None:
        x = min(self.screen_width - 1, max(0, int(event.x * self.scale)))
        y = min(self.screen_height - 1, max(0, int(event.y * self.scale)))
        self.selected = (x, y)
        self.coordinate_value.set(f"선택 좌표: ({x}, {y})")
        self.canvas.delete("selection")
        radius = 8
        self.canvas.create_oval(
            event.x - radius,
            event.y - radius,
            event.x + radius,
            event.y + radius,
            outline="red",
            width=3,
            tags="selection",
        )

    def save_and_execute(self) -> None:
        if self.selected is None:
            messagebox.showwarning("좌표 필요", "화면에서 버튼을 먼저 클릭하세요.")
            return
        label = self.label_value.get().strip() or f"Step {len(self.steps) + 1}"
        x, y = self.selected
        self.steps.append(
            {
                "label": label,
                "x": x,
                "y": y,
                "wait_seconds": self.config.refresh_automation.tap_wait_seconds,
            }
        )
        self.status.set(f"저장 및 실행: {label} ({x}, {y})")
        self.root.update_idletasks()
        self.adb.tap(x, y)
        time.sleep(self.config.refresh_automation.tap_wait_seconds)
        label_prefix = WORKFLOW_LABELS[self.workflow_id]
        self.label_value.set(f"{label_prefix} 단계 {len(self.steps) + 1}")
        self.refresh_screenshot()

    def go_back(self) -> None:
        self.adb.keyevent(4)
        time.sleep(1.5)
        self.refresh_screenshot()

    def remove_last(self) -> None:
        if not self.steps:
            return
        removed = self.steps.pop()
        self.status.set(f"마지막 단계 제거: {removed['label']}")
        self.label_value.set(
            f"{WORKFLOW_LABELS[self.workflow_id]} 단계 {len(self.steps) + 1}"
        )

    def finish(self) -> None:
        if not self.steps:
            messagebox.showwarning(
                "저장할 단계 없음",
                "최소 한 개의 화면 이동 좌표를 저장해야 합니다.",
            )
            return

        target = (
            self.config.refresh_automation.sequence_dir
            / f"{self.workflow_id}.json"
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 2,
            "workflow_id": self.workflow_id,
            "device_serial": self.serial,
            "screen_size": {
                "width": self.screen_width,
                "height": self.screen_height,
            },
            "steps": self.steps,
        }
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        messagebox.showinfo(
            "보정 완료",
            f"{len(self.steps)}개 단계가 저장됐습니다.\n{target.resolve()}\n\n"
            "Refresh Worker가 다음 유휴 시간부터 이 경로를 사용할 수 있습니다.",
        )
        self.root.destroy()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record a Dark War read-only refresh workflow."
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--workflow", choices=CALIBRATABLE, required=True)
    args = parser.parse_args()

    try:
        RefreshCalibrator(Path(args.config), args.workflow).launch()
    except (AdbError, OSError, tk.TclError) as exc:
        print(f"Calibration failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
