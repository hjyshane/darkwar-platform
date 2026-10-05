"""Game icons out of the client's asset pack, small enough for a database row.

The data tables name a sprite for each hero, weapon, gear piece and item
(catalog.icon_refs); the sprites live in the install-time asset pack the
Play Store delivers beside the APK, `split_install_time_pack.apk` (~2 GB),
copied off BlueStacks into C:/DW_data/gamedata/apk and never committed
(docs/runbooks/game-data.md). It is a zip of AssetBundles; the images are in
the sprite, atlas and texture bundles, about 1,169 of its 4,288.

The art is the game company's. It goes to a members-only table (0232) as a
small WebP, never to a public URL (user, 2026-10-05).

UnityPy and Pillow are the `gamedata` extra, imported here only.
"""

from __future__ import annotations

import base64
import io
import re
import zipfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from dw_collector.gamedata.bundles import strip_prefix

# Long side in pixels. The dashboard draws icons at 24-64 px; 96 keeps them
# sharp on a high-density screen and a hero portrait near 6 KB.
ICON_SIZE = 96
WEBP_QUALITY = 80

# Only these bundles hold images; models, audio and prefabs are most of the
# pack and are never opened.
_IMAGE_BUNDLE = re.compile(r"sprite|atlas|texture|icon")


def to_webp(image: Any, size: int = ICON_SIZE) -> tuple[str, int, int]:
    """A PIL image as base64 WebP no larger than `size` on its long side,
    with its width and height."""
    img = image.convert("RGBA")
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
    return base64.b64encode(buf.getvalue()).decode("ascii"), img.width, img.height


def extract(pack: Path, wanted: Iterable[str]) -> dict[str, dict[str, Any]]:
    """{sprite name: {icon_key, image, width, height}} for every wanted
    sprite found in the asset pack. A name in more than one bundle takes the
    first."""
    import UnityPy

    remaining = set(wanted)
    found: dict[str, dict[str, Any]] = {}
    with zipfile.ZipFile(pack) as z:
        for path in z.namelist():
            if not remaining:
                break
            name = path.rsplit("/", 1)[-1]
            if not name.endswith(".bundle") or not _IMAGE_BUNDLE.search(name):
                continue
            env = UnityPy.load(strip_prefix(z.read(path)))
            for obj in env.objects:
                if obj.type.name != "Sprite":
                    continue
                sprite = obj.read()
                key = sprite.m_Name
                if key not in remaining:
                    continue
                image, width, height = to_webp(sprite.image)
                found[key] = {"icon_key": key, "image": image, "width": width, "height": height}
                remaining.discard(key)
    return found
