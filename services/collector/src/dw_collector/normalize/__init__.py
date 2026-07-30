"""Normalizers register themselves on import."""

from dw_collector.normalize import (
    al_rank,
    alliance_donate_rank,
    alliance_rank,
    arena,
    get_al_info,
    get_new_user_info,
    get_user_info_multi,
    kill_rank,
    server_rank,
)

__all__ = [
    "al_rank",
    "alliance_donate_rank",
    "alliance_rank",
    "arena",
    "get_al_info",
    "get_new_user_info",
    "get_user_info_multi",
    "kill_rank",
    "server_rank",
]
