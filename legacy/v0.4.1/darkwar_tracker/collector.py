from __future__ import annotations

import argparse
import ctypes
import datetime as dt
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import sys
from typing import Any

from .config import load_config
from .database import Database
from .protocol import extract_extension_event
from .reassembly import TCPDirectionReassembler


def is_windows_admin() -> bool:
    if sys.platform != "win32":
        return True
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def setup_logging(verbose: bool) -> logging.Logger:
    Path("logs").mkdir(exist_ok=True)
    logger = logging.getLogger("darkwar.collector")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s"
    )

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    logger.addHandler(console)

    file_handler = RotatingFileHandler(
        "logs/collector.log",
        maxBytes=5_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


class LiveCollector:
    def __init__(
        self,
        database: Database,
        port: int,
        server_ip: str | None,
        logger: logging.Logger,
    ):
        self.database = database
        self.port = port
        self.server_ip = server_ip
        self.logger = logger
        self.streams: dict[
            tuple[str, int, str, int], TCPDirectionReassembler
        ] = {}

    def handle_packet(self, packet: Any) -> None:
        """Scapy callback that must never terminate the capture socket."""
        try:
            self._handle_packet(packet)
        except Exception:
            self.logger.exception(
                "packet processing failed; capture will continue"
            )

    def _handle_packet(self, packet: Any) -> None:
        try:
            from scapy.layers.inet import IP, TCP
            from scapy.packet import Raw
        except ImportError:
            return

        if not packet.haslayer(IP) or not packet.haslayer(TCP):
            return
        if not packet.haslayer(Raw):
            return

        ip = packet[IP]
        tcp = packet[TCP]
        payload = bytes(packet[Raw].load)

        if not payload:
            return
        if self.port not in (int(tcp.sport), int(tcp.dport)):
            return
        if self.server_ip and self.server_ip not in (ip.src, ip.dst):
            return

        key = (ip.src, int(tcp.sport), ip.dst, int(tcp.dport))
        reassembler = self.streams.setdefault(
            key, TCPDirectionReassembler()
        )
        frames = reassembler.feed(int(tcp.seq), payload)
        direction = "inbound" if int(tcp.sport) == self.port else "outbound"

        for frame in frames:
            event = extract_extension_event(frame.object)
            if event is None:
                continue

            command, event_payload, request_id = event
            captured_at = dt.datetime.now(dt.timezone.utc).isoformat()

            try:
                result = self.database.handle_event(
                    direction=direction,
                    command=command,
                    payload=event_payload,
                    request_id=request_id,
                    captured_at=captured_at,
                )
            except Exception:
                self.logger.exception(
                    "failed to store command=%s id=%s; continuing capture",
                    command,
                    request_id,
                )
                continue

            self.logger.debug(
                "%s %s id=%s compressed=%s encoded=%s decoded=%s",
                direction,
                command,
                request_id,
                frame.compressed,
                frame.encoded_length,
                frame.decoded_length,
            )

            if result:
                self.logger.info(result)


def list_interfaces() -> int:
    try:
        from scapy.all import get_working_ifaces
    except ImportError:
        print("Scapy is not installed. Run setup.bat first.")
        return 1

    print("Available interfaces:")
    for interface in get_working_ifaces():
        print(
            f"- name={interface.name!r}\n"
            f"  description={interface.description!r}\n"
            f"  ip={interface.ip!r}"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Passively collect Dark War SmartFox responses into SQLite."
        )
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--interface")
    parser.add_argument("--port", type=int)
    parser.add_argument("--server-ip")
    parser.add_argument("--db")
    parser.add_argument("--list-interfaces", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if args.list_interfaces:
        return list_interfaces()

    if not is_windows_admin():
        print(
            "Packet capture requires Administrator privileges on Windows.\n"
            "Run start_collector.ps1 or open PowerShell as Administrator."
        )
        return 2

    try:
        from scapy.all import conf, sniff
    except ImportError:
        print("Scapy is not installed. Run setup.bat first.")
        return 3

    config = load_config(args.config)
    interface = args.interface or config.capture.interface
    port = args.port or config.capture.port
    server_ip = args.server_ip or config.capture.server_ip
    db_path = Path(args.db) if args.db else config.database.path

    logger = setup_logging(args.verbose)
    database = Database(db_path, top_n=config.tracking.top_n)
    collector = LiveCollector(database, port, server_ip, logger)

    conf.use_pcap = True

    bpf = f"tcp port {port}"
    if server_ip:
        bpf += f" and host {server_ip}"

    logger.info("database: %s", db_path.resolve())
    logger.info("capture interface: %s", interface or conf.iface)
    logger.info("capture filter: %s", bpf)
    logger.info(
        "Open alliance rankings or member lists in BlueStacks. "
        "Press Ctrl+C to stop."
    )

    try:
        sniff(
            iface=interface,
            filter=bpf,
            prn=collector.handle_packet,
            store=False,
        )
    except KeyboardInterrupt:
        logger.info("collector stopped")
    except Exception:
        logger.exception(
            "capture failed. Confirm Npcap is installed and the interface "
            "is correct."
        )
        return 4
    finally:
        database.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
