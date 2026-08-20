"""Normalizers register themselves on import."""

from dw_collector.normalize import (
    al_rank,
    alliance_battle_rank,
    alliance_donate_rank,
    alliance_rank,
    arena,
    desert_force_rank,
    fight_report_detail,
    get_al_info,
    get_new_user_info,
    get_user_info_multi,
    kill_rank,
    mail_read_share,
    rank_by_range,
    season_score_rank,
    server_rank,
)

__all__ = [
    "al_rank",
    "alliance_battle_rank",
    "alliance_donate_rank",
    "alliance_rank",
    "arena",
    "desert_force_rank",
    "fight_report_detail",
    "get_al_info",
    "get_new_user_info",
    "get_user_info_multi",
    "kill_rank",
    "mail_read_share",
    "rank_by_range",
    "season_score_rank",
    "server_rank",
]
