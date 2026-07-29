"""Live packet source (Windows + Npcap). The only scapy-aware module.

Deliberately thin: it converts sniffed packets into `TcpSegment` and hands
them to a callback, which `CaptureSession.feed` satisfies. scapy is an
optional dependency (`uv sync --extra capture`) so CI and the whole
pipeline stay installable and testable without Npcap.

scapy's `sniff()` is blocking and returns a PacketList only once capture
*ends*, so it cannot be iterated as a stream — an endless live capture
would never yield a single packet. Delivery therefore goes through `prn`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from dw_collector.protocol.pcapng import TcpSegment

DEFAULT_PORT = 8680

_scapy: Any = None


def _require_scapy() -> Any:
    global _scapy
    if _scapy is None:
        try:
            from scapy import all as scapy_all
        except ImportError as exc:  # pragma: no cover - depends on the extra
            msg = (
                "live capture needs the capture extra and Npcap:"
                " uv sync --extra capture (Windows only)"
            )
            raise RuntimeError(msg) from exc
        _scapy = scapy_all
    return _scapy


def list_interfaces() -> list[str]:  # pragma: no cover - needs Npcap
    scapy_all = _require_scapy()
    return [str(name) for name in scapy_all.get_if_list()]


def to_segment(packet: Any) -> TcpSegment | None:
    """scapy packet → TcpSegment, or None when it is not usable TCP data."""
    scapy_all = _require_scapy()
    if not packet.haslayer(scapy_all.TCP) or not packet.haslayer(scapy_all.IP):
        return None
    ip = packet[scapy_all.IP]
    tcp = packet[scapy_all.TCP]
    payload = bytes(tcp.payload)
    if not payload:
        return None
    return TcpSegment(
        source_ip=str(ip.src),
        destination_ip=str(ip.dst),
        source_port=int(tcp.sport),
        destination_port=int(tcp.dport),
        sequence=int(tcp.seq),
        payload=payload,
    )


def sniff_into(
    handle_segment: Callable[[TcpSegment], None],
    interface: str | None = None,
    port: int = DEFAULT_PORT,
    *,
    timeout: float | None = None,
    count: int = 0,
) -> None:
    """Passive capture only: no packet is ever injected or modified.

    Blocks until `timeout`/`count` is reached, or until interrupted. Every
    decodable segment is handed to `handle_segment` as it arrives, so a
    long-running capture journals continuously instead of buffering.
    """
    scapy_all = _require_scapy()

    def _deliver(packet: Any) -> None:
        segment = to_segment(packet)
        if segment is not None:
            handle_segment(segment)

    scapy_all.sniff(
        iface=interface,
        filter=f"tcp port {port}",
        store=False,
        prn=_deliver,
        timeout=timeout,
        count=count,
    )
