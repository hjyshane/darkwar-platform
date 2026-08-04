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


class InterfaceNotFoundError(RuntimeError):
    """DW_CAPTURE_INTERFACE names an adapter this machine does not have."""


def check_interface(interface: str | None, known: list[str]) -> None:
    """Refuse a name no adapter answers to, rather than capturing nothing.

    scapy does not complain about an unknown interface: it sniffs, delivers
    no packets, and the process looks healthy forever. That cost a session —
    the adapter here is named 이더넷, capture logged its start, journalled
    zero observations, and nothing anywhere said why. An unattended
    collector would have done that silently for days, and the heartbeat
    would have kept saying it was alive, because it was.

    Non-ASCII friendly names are the usual way in, so the message names the
    device form (\\Device\\NPF_{GUID}) that has no encoding to get wrong.
    """
    if interface is None or interface in known:
        return
    msg = (
        f"capture interface {interface!r} matches no adapter on this machine."
        f" Known: {known}."
        " Prefer the device form, e.g. \\Device\\NPF_{GUID}, which is ASCII"
        " and cannot be mangled by a locale."
    )
    raise InterfaceNotFoundError(msg)


def _known_interfaces(scapy_all: Any) -> list[str]:
    """Every name scapy would accept, both friendly and device form."""
    names: list[str] = []
    for dev in scapy_all.get_windows_if_list():
        name = dev.get("name")
        guid = dev.get("guid")
        if name:
            names.append(str(name))
        if guid:
            names.append(f"\\Device\\NPF_{guid}")
    return names


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

    # Only where the list is available; scapy exposes get_windows_if_list on
    # Windows, and this whole module only ever runs there in production.
    if interface is not None and hasattr(scapy_all, "get_windows_if_list"):
        check_interface(interface, _known_interfaces(scapy_all))

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
