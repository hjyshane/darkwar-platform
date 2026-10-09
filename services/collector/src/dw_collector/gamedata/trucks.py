"""Which client sprite draws a truck on the world map.

The lod atlas holds `truck_lod_<colour><n>` for five colours and n = 0-7. The
eight are the eight headings, 45 degrees apart and clockwise from north: 0
faces away up the screen, 2 faces right, 4 faces the viewer, 6 faces left.
The colour is the truck's quality (hunt.ts QUALITY_NAMES: grey, green, blue,
purple, orange); the client calls grey "ash".
"""

from __future__ import annotations

from collections.abc import Iterator

COLOURS: dict[int, str] = {1: "ash", 2: "green", 3: "blue", 4: "purple", 5: "orange"}
DIRECTIONS = 8


def truck_ref(quality: int, direction: int) -> str:
    """`ref_id` of a truck picture in game_icon_refs."""
    return f"{quality}-{direction}"


def truck_sprites() -> Iterator[tuple[int, int, str]]:
    """(quality, direction, sprite name) for every picture."""
    for quality, colour in COLOURS.items():
        for direction in range(DIRECTIONS):
            yield quality, direction, f"truck_lod_{colour}{direction}"
