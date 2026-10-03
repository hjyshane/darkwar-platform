"""The game client's downloaded data bundles → their text assets.

The client keeps its datatables and localisation as Unity AssetBundles under
`/sdcard/Android/data/com.readygo.dark.gp/files/AssetBundles` (copied out
with adb; docs/runbooks/game-data.md). Two things stand between a bundle
and a reader:

- Every bundle file starts with eight bytes, `UnityRaw`, glued in front of an
  otherwise ordinary `UnityFS` bundle. UnityPy reads the bundle fine once
  they are gone, and finds nothing at all while they are there.
- The assets inside are TextAssets whose names collide — every language's
  `Dialog_1` is called `Dialog_1` — so they are keyed by container path
  (`assets/main/datatable/localization/english/dictionaries/dialog_1.txt`),
  which does not.

UnityPy is the `gamedata` extra, imported here and nowhere else, so the
collector itself never needs it.
"""

from __future__ import annotations

from pathlib import Path

PREFIX = b"UnityRaw"


def strip_prefix(data: bytes) -> bytes:
    """The bundle without the client's eight-byte prefix, if it has one."""
    return data[len(PREFIX) :] if data.startswith(PREFIX) else data


def text_assets(data: bytes) -> dict[str, bytes]:
    """Every TextAsset in one bundle, keyed by lower-cased container path."""
    import UnityPy

    env = UnityPy.load(strip_prefix(data))
    # A container entry is a pointer; UnityPy's types call its id m_PathID,
    # the object it points at calls it path_id.
    by_id = {
        getattr(ptr, "m_PathID", None) or getattr(ptr, "path_id", None): path
        for path, ptr in (env.container or {}).items()
    }
    out: dict[str, bytes] = {}
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        asset = obj.read()
        script = getattr(asset, "m_Script", None)
        if script is None:
            script = asset.script
        if isinstance(script, str):
            script = script.encode("utf-8", "surrogateescape")
        key = by_id.get(obj.path_id) or f"{asset.m_Name}#{obj.path_id}"
        out[key.lower()] = bytes(script)
    return out


def read_dir(directory: Path) -> dict[str, bytes]:
    """All text assets from every `*.bundle` in a directory."""
    assets: dict[str, bytes] = {}
    for path in sorted(directory.glob("*.bundle")):
        assets.update(text_assets(path.read_bytes()))
    return assets
