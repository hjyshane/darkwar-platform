"""Live packet source (Windows + Npcap). The only scapy-aware module.

Deliberately thin: it converts sniffed packets into `TcpSegment` and hands
them to `CaptureSession`, which is what the tests drive directly. scapy is
an optional dependency (`uv sync --extra capture`) so CI and the whole
pipeline stay installable and testable without Npcap.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from dw_collector.protocol.pcapng import TcpSegment

DEFAULT_PORT = 8680


def _require_scapy() -> Any:
    try:
        from scapy import all as scapy_all
    except ImportError as exc:  # pragma: no cover - depends on the extra
        msg = (
            "live capture needs the capture extra and Npcap: uv sync --extra capture (Windows only)"
        )
        raise RuntimeError(msg) from exc
    return scapy_all


def list_interfaces() -> list[str]:  # pragma: no cover - needs Npcap
    scapy_all = _require_scapy()
    return [str(name) for name in scapy_all.get_if_list()]


def to_segment(packet: Any) -> TcpSegment | None:  # pragma: no cover - needs scapy types
    """scapy packet → TcpSegment, or None when it is not game TCP traffic."""
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


def sniff_segments(
    interface: str | None = None, port: int = DEFAULT_PORT
) -> Iterator[TcpSegment]:  # pragma: no cover - needs Npcap
    """Passive capture only: no packet is ever injected or modified."""
    scapy_all = _require_scapy()
    for packet in scapy_all.sniff(
        iface=interface, filter=f"tcp port {port}", store=False, prn=None
    ):
        segment = to_segment(packet)
        if segment is not None:
            yield segment
