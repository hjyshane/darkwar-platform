"""Link layer → IP packet, for every link type a Mac capture can produce.

The Windows collector only ever saw Ethernet: dumpcap on the adapter that
carries BlueStacks' traffic. A Mac is less uniform. Wi-Fi (`en0`) is still
Ethernet, but capturing on loopback gives BSD NULL framing, `-i any` gives
Apple's PKTAP wrapper, a utun/VPN interface gives raw IP, and a pcap that
went through a Linux box comes back as "cooked" SLL. They all carry the same
IP packet; only the bytes in front of it differ.

Everything here answers one question — where does the IP packet start — and
returns None for anything that is not IPv4 or IPv6. Pure stdlib.
"""

from __future__ import annotations

import struct

# pcap LINKTYPE_* values (tcpdump.org/linktypes.html).
LINKTYPE_NULL = 0
LINKTYPE_ETHERNET = 1
LINKTYPE_RAW = 101
LINKTYPE_LOOP = 108
LINKTYPE_LINUX_SLL = 113
LINKTYPE_PKTAP = 258
LINKTYPE_IPV4 = 228
LINKTYPE_IPV6 = 229
LINKTYPE_LINUX_SLL2 = 276

SUPPORTED_LINKTYPES = frozenset(
    {
        LINKTYPE_NULL,
        LINKTYPE_ETHERNET,
        LINKTYPE_RAW,
        LINKTYPE_LOOP,
        LINKTYPE_LINUX_SLL,
        LINKTYPE_PKTAP,
        LINKTYPE_IPV4,
        LINKTYPE_IPV6,
        LINKTYPE_LINUX_SLL2,
    }
)

_ETHERTYPE_IPV4 = 0x0800
_ETHERTYPE_IPV6 = 0x86DD
_ETHERTYPE_VLAN = (0x8100, 0x88A8)

# BSD loopback carries the socket address family, and AF_INET6 is not one
# number: 24 on NetBSD/OpenBSD, 28 on FreeBSD, 30 on macOS. AF_INET is 2
# everywhere.
_AF_INET = 2
_AF_INET6 = (24, 28, 30)

# Inside a PKTAP header, the next header is named by its DLT, not its
# LINKTYPE. They agree except for raw IP, which is DLT 12 on macOS.
_PKTAP_DLT_RAW = 12


def network_packet(frame: bytes, linktype: int) -> bytes | None:
    """The IP packet inside one captured frame, or None if there is none."""
    return _network_packet(frame, linktype, depth=0)


def _network_packet(frame: bytes, linktype: int, *, depth: int) -> bytes | None:
    if linktype == LINKTYPE_ETHERNET:
        return _ethernet(frame)
    if linktype in (LINKTYPE_RAW, LINKTYPE_IPV4, LINKTYPE_IPV6):
        return _ip_only(frame)
    if linktype == LINKTYPE_NULL:
        return _bsd_loopback(frame, network_order=False)
    if linktype == LINKTYPE_LOOP:
        return _bsd_loopback(frame, network_order=True)
    if linktype == LINKTYPE_LINUX_SLL:
        return _by_ethertype(frame, header=16, type_at=14)
    if linktype == LINKTYPE_LINUX_SLL2:
        return _by_ethertype(frame, header=20, type_at=0)
    if linktype == LINKTYPE_PKTAP and depth == 0:
        return _pktap(frame, depth=depth)
    return None


def _ip_only(packet: bytes) -> bytes | None:
    if not packet or packet[0] >> 4 not in (4, 6):
        return None
    return packet


def _ethernet(frame: bytes) -> bytes | None:
    if len(frame) < 14:
        return None
    ether_type = int(struct.unpack_from("!H", frame, 12)[0])
    offset = 14
    if ether_type in _ETHERTYPE_VLAN:
        if len(frame) < 18:
            return None
        ether_type = int(struct.unpack_from("!H", frame, 16)[0])
        offset = 18
    if ether_type not in (_ETHERTYPE_IPV4, _ETHERTYPE_IPV6):
        return None
    return frame[offset:]


def _by_ethertype(frame: bytes, *, header: int, type_at: int) -> bytes | None:
    if len(frame) < header:
        return None
    ether_type = int(struct.unpack_from("!H", frame, type_at)[0])
    if ether_type not in (_ETHERTYPE_IPV4, _ETHERTYPE_IPV6):
        return None
    return frame[header:]


def _bsd_loopback(frame: bytes, *, network_order: bool) -> bytes | None:
    """NULL stores the family in the CAPTURING host's byte order, which the
    file does not record — so try both. A family is a small number, which
    makes the wrong order unmistakable."""
    if len(frame) < 4:
        return None
    orders = ("!",) if network_order else ("<", ">")
    for order in orders:
        family = int(struct.unpack_from(order + "I", frame, 0)[0])
        if family == _AF_INET or family in _AF_INET6:
            return _ip_only(frame[4:])
    return None


def _pktap(frame: bytes, *, depth: int) -> bytes | None:
    """Apple's PKTAP: a header whose own first field is its length, then the
    real frame in the link type its second field names. Both fields are in
    host order, and every Mac that writes one is little-endian."""
    if len(frame) < 8:
        return None
    header_length, inner = struct.unpack_from("<II", frame, 0)
    if header_length < 8 or header_length > len(frame):
        return None
    inner_linktype = LINKTYPE_RAW if inner == _PKTAP_DLT_RAW else int(inner)
    return _network_packet(frame[header_length:], inner_linktype, depth=depth + 1)
