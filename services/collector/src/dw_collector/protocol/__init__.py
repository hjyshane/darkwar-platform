"""SmartFox protocol decode, promoted from legacy/v0.4.1 (protocol.py,
reassembly.py, offline.py) with fixtures and replay tests.

Nothing here touches a live socket or scapy: input is bytes (or a pcapng
file), output is decoded objects. Live capture (S15) is a separate producer
that feeds these same decoders.
"""

from dw_collector.protocol.frames import (
    SmartFoxFrame,
    SmartFoxStreamDecoder,
    extract_extension_event,
)
from dw_collector.protocol.sfs import ParseError, Reader, parse_sfs_value

__all__ = [
    "ParseError",
    "Reader",
    "SmartFoxFrame",
    "SmartFoxStreamDecoder",
    "extract_extension_event",
    "parse_sfs_value",
]
