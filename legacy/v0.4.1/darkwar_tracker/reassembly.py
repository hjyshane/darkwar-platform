from __future__ import annotations

from dataclasses import dataclass, field

from .protocol import SmartFoxFrame, SmartFoxStreamDecoder


@dataclass
class TCPDirectionReassembler:
    """Small directional TCP reassembler suitable for one long game session."""

    decoder: SmartFoxStreamDecoder = field(default_factory=SmartFoxStreamDecoder)
    next_sequence: int | None = None
    pending: dict[int, bytes] = field(default_factory=dict)

    def feed(self, sequence: int, payload: bytes) -> list[SmartFoxFrame]:
        if not payload:
            return []

        if self.next_sequence is None:
            self.next_sequence = sequence

        assert self.next_sequence is not None

        end_sequence = sequence + len(payload)
        if end_sequence <= self.next_sequence:
            return []

        if sequence < self.next_sequence:
            trim = self.next_sequence - sequence
            payload = payload[trim:]
            sequence = self.next_sequence

        existing = self.pending.get(sequence)
        if existing is None or len(payload) > len(existing):
            self.pending[sequence] = payload

        frames: list[SmartFoxFrame] = []

        while self.next_sequence in self.pending:
            chunk = self.pending.pop(self.next_sequence)
            self.next_sequence += len(chunk)
            frames.extend(self.decoder.feed(chunk))

        # Avoid unbounded memory if capture begins with a missing segment.
        if len(self.pending) > 512:
            lowest = min(self.pending)
            self.next_sequence = lowest

        return frames
