"""HQ towers for the world map, rendered from the client's own 3D models.

The world map draws a player's base as a tower that changes with HQ level. The
client has no sprite for it: `building.bytes` row `4000<level>` names the model
in `model_world` (`building_400031_world`), and the mesh and texture are in the
`A_Build_DaBen_All` bundle of the asset pack as `A_build_daben_<NN>` with a
`_day_D` texture. Levels 10-13 are stacked pieces (`tashen`/`wuding` or
`xia`/`zhong`/`shang`) drawn together, and the pieces share one origin.

There is no GPU here: a few thousand triangles are rasterised in numpy at 2x
and downscaled, which is plenty for 11 pictures. The art is the game company's
and goes to the members-only `game_icons` table (0232/0268), like every icon.

UnityPy, Pillow and numpy are the `gamedata` extra, imported here only.
"""

from __future__ import annotations

import math
import re
import zipfile
from pathlib import Path
from typing import Any

from dw_collector.gamedata.bundles import strip_prefix, text_assets
from dw_collector.gamedata.icons import to_webp
from dw_collector.gamedata.luatable import decode

# Long side of a stored tower. They are drawn at 60-160 px on a high-density
# screen; the 96 px of the other icons would blur.
TOWER_SIZE = 192

_BUILDING_BUNDLE = "gameres_art_buildings_a_build_daben_all_"
_DATATABLE_BUNDLE = "datatable_config"
_WORLD_MODEL = re.compile(r"^building_4000(\d\d)_world$")
# Pieces of the tiers that are not one mesh.
_PARTS: dict[int, tuple[str, ...]] = {
    10: ("tashen", "wuding"),
    11: ("tashen", "wuding"),
    12: ("xia", "zhong", "shang"),
    13: ("xia", "zhong", "shang"),
}


def tier_pieces(tier: int) -> list[tuple[str, str]]:
    """(mesh name, texture name) for each piece of a tier."""
    base = f"A_build_daben_{tier:02d}"
    parts = _PARTS.get(tier)
    if parts is None:
        return [(base, f"{base}_day_D")]
    return [(f"{base}_{p}", f"{base}_{p}_day_D") for p in parts]


def level_tiers(model_world: dict[int, str]) -> dict[int, int]:
    """HQ level -> tier number from `{level: model_world}` rows. A model that is
    not `building_4000NN_world` (a skin, a special) has no tier and is left out."""
    tiers: dict[int, int] = {}
    for level, model in model_world.items():
        found = _WORLD_MODEL.match(model)
        if found:
            tiers[level] = int(found.group(1))
    return tiers


def read_level_models(pack: Path) -> dict[int, str]:
    """{HQ level: model_world} for building ids 400001-400099 of the pack."""
    models: dict[int, str] = {}
    with zipfile.ZipFile(pack) as z:
        for path in z.namelist():
            if _DATATABLE_BUNDLE not in path or not path.endswith(".bundle"):
                continue
            for key, data in text_assets(z.read(path)).items():
                if not key.endswith("/building.bytes"):
                    continue
                for row_id, row in decode(data, key).rows.items():
                    level = int(row_id) - 400000
                    if 1 <= level <= 99 and row.get("model_world"):
                        models[level] = str(row["model_world"])
                return models
    return models


def parse_obj(text: str) -> tuple[Any, Any, Any]:
    """Vertices, UVs and triangles (a, b, c, ta, tb, tc) of an OBJ string."""
    import numpy as np

    verts: list[list[float]] = []
    uvs: list[list[float]] = []
    tris: list[tuple[int, ...]] = []
    for line in text.splitlines():
        if line.startswith("v "):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            uvs.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("f "):
            idx = [p.split("/") for p in line.split()[1:]]
            vi = [int(p[0]) - 1 for p in idx]
            ti = [int(p[1]) - 1 if len(p) > 1 and p[1] else 0 for p in idx]
            for k in range(1, len(vi) - 1):
                tris.append((vi[0], vi[k], vi[k + 1], ti[0], ti[k], ti[k + 1]))
    return (
        np.array(verts, dtype=float),
        np.array(uvs, dtype=float).reshape(-1, 2),
        np.array(tris, dtype=int),
    )


def rasterise(parts: list[tuple[Any, Any, Any, Any]], size: int = 512, ss: int = 2) -> Any:
    """Render pieces (vertices, uvs, triangles, RGBA texture array) from the
    angle the world map is seen at, as a cropped RGBA PIL image."""
    import numpy as np
    from PIL import Image

    yaw, pitch = math.radians(35.0), math.radians(38.0)
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    side = size * ss
    colour = np.zeros((side, side, 4), np.float32)
    zbuf = np.full((side, side), -1e9, np.float32)

    def project(v: Any) -> Any:
        x = v[:, 0] * cy + v[:, 2] * sy
        z = -v[:, 0] * sy + v[:, 2] * cy
        return np.stack([x, v[:, 1] * cp - z * sp, v[:, 1] * sp + z * cp], 1)

    allt = project(np.concatenate([p[0] for p in parts]))
    lo, hi = allt.min(0), allt.max(0)
    scale = 0.92 * side / max(hi[0] - lo[0], hi[1] - lo[1])
    mid_x, mid_y = (hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2
    light = np.array([0.35, 0.8, 0.5])
    light /= np.linalg.norm(light)
    for verts, uvs, tris, tex in parts:
        t = project(verts)
        sx = (t[:, 0] - mid_x) * scale + side / 2
        sy_ = side / 2 - (t[:, 1] - mid_y) * scale
        th, tw = tex.shape[:2]
        for a, b, c, ta, tb, tc in tris:
            x0, x1, x2 = sx[a], sx[b], sx[c]
            y0, y1, y2 = sy_[a], sy_[b], sy_[c]
            minx = max(0, math.floor(min(x0, x1, x2)))
            maxx = min(side - 1, math.ceil(max(x0, x1, x2)))
            miny = max(0, math.floor(min(y0, y1, y2)))
            maxy = min(side - 1, math.ceil(max(y0, y1, y2)))
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if maxx < minx or maxy < miny or abs(den) < 1e-9:
                continue
            xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
            w0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den
            w1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            depth = w0 * t[a, 2] + w1 * t[b, 2] + w2 * t[c, 2]
            window = zbuf[miny : maxy + 1, minx : maxx + 1]
            inside &= depth > window
            if not inside.any():
                continue
            u = w0 * uvs[ta, 0] + w1 * uvs[tb, 0] + w2 * uvs[tc, 0]
            v = w0 * uvs[ta, 1] + w1 * uvs[tb, 1] + w2 * uvs[tc, 1]
            px = np.clip((u % 1.0) * tw, 0, tw - 1).astype(int)
            py = np.clip((1 - (v % 1.0)) * th, 0, th - 1).astype(int)
            rgba = tex[py, px].astype(np.float32)
            normal = np.cross(verts[b] - verts[a], verts[c] - verts[a])
            length = np.linalg.norm(normal)
            shade = 0.75 + 0.25 * abs(float(normal @ light) / length) if length else 1.0
            rgba[..., :3] *= shade
            region = colour[miny : maxy + 1, minx : maxx + 1]
            region[inside] = rgba[inside]
            region[inside, 3] = 255
            window[inside] = depth[inside]
    image = Image.fromarray(np.clip(colour, 0, 255).astype(np.uint8), "RGBA")
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    box = image.getchannel("A").getbbox()
    return image.crop(box) if box else image


def render_tiers(pack: Path, tiers: set[int]) -> dict[int, dict[str, Any]]:
    """{tier: {icon_key, image, width, height}} for the tiers the pack can draw."""
    import numpy as np
    import UnityPy

    with zipfile.ZipFile(pack) as z:
        name = next(n for n in z.namelist() if _BUILDING_BUNDLE in n)
        env = UnityPy.load(strip_prefix(z.read(name)))
    meshes: dict[str, Any] = {}
    textures: dict[str, Any] = {}
    for obj in env.objects:
        if obj.type.name in ("Mesh", "Texture2D"):
            asset = obj.read()
            (meshes if obj.type.name == "Mesh" else textures)[asset.m_Name] = asset
    out: dict[int, dict[str, Any]] = {}
    for tier in sorted(tiers):
        parts = []
        for mesh_name, texture_name in tier_pieces(tier):
            if mesh_name not in meshes or texture_name not in textures:
                break
            verts, uvs, tris = parse_obj(meshes[mesh_name].export())
            texture = np.array(textures[texture_name].image.convert("RGBA"))
            parts.append((verts, uvs, tris, texture))
        else:
            image, width, height = to_webp(rasterise(parts), TOWER_SIZE)
            out[tier] = {
                "icon_key": f"tower_{tier:02d}",
                "image": image,
                "width": width,
                "height": height,
            }
    return out
