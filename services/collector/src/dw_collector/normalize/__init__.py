"""Normalizers register themselves on import."""

from dw_collector.normalize import (
    al_rank,
    alliance_donate_rank,
    alliance_rank,
    arena,
    fight_report_detail,
    get_al_info,
    get_new_user_info,
    get_user_info_multi,
    kill_rank,
    mail_read_share,
    rank_by_range,
    server_rank,
)

__all__ = [
    "al_rank",
    "alliance_donate_rank",
    "alliance_rank",
    "arena",
    "fight_report_detail",
    "get_al_info",
    "get_new_user_info",
    "get_user_info_multi",
    "kill_rank",
    "mail_read_share",
    "rank_by_range",
    "server_rank",
]
