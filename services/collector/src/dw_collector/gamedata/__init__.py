"""Reading the game client's own data files (docs/runbooks/game-data.md).

Needs the `gamedata` extra (UnityPy, lupa); nothing else in the collector
imports this package.
"""

from dw_collector.gamedata.bundles import read_dir, strip_prefix, text_assets
from dw_collector.gamedata.luatable import Datatable, DatatableError, decode, repair_header
from dw_collector.gamedata.names import datatable_bytes, event_names, localisation

__all__ = [
    "Datatable",
    "DatatableError",
    "datatable_bytes",
    "decode",
    "event_names",
    "localisation",
    "read_dir",
    "repair_header",
    "strip_prefix",
    "text_assets",
]
