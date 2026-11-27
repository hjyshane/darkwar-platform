"""Which packs this account is actually sold, and what the empty ones pay → shop_pack_offers (0337).

`exchange.info` is the whole pack table, not the store: on 2026-11-19 it
listed 107 battle-pass packs with no contents and four stages of every weekly
pass, and nothing in it says which the account sees. The screens that SELL
those packs do. Each asks its own command at login, and the answer names the
pack by its exchange id — and, for a pass, lists the rewards level by level,
which is exactly what the pack list leaves out.

Checked against that day's catalog (423 packs): every id below is a pack in
it, of the type the screen is for, and its unnamed siblings are the other
servers' or other stages' versions (8 of 107 passes named, 8 of 16 weekly
passes, 1 of 7 season weekly cards, 1 of 2 radar cards).

    command                           pack id(s)                    contents
    get.battlepass.info               exchangeId                    stateInfo[].specialReward
                                      extExchangeId                 stateInfo[].middleReward
                                      seriesExchangeIds[]           stateInfo[].specialReward
    get.season.battlepass.info        packageIds "a;b"              a: middle, b: specialReward
    growth.plan.info                  exchangeId                    stageInfo[].specialReward
    get.month.detect.card             monthDetectCards[].exchangeId scoreRewardArr[].payReward
    get.week.card.info                weekCards[].exchange_id       reward x time (daily claims)
    get.season.week.card.info         exchangeId                    (the pack lists its own)
    multi.choice.gift.info            gifts[].exchangeId            (the pack lists its own)
    get.custom.package.activity.info  exchangeIds "a;b;…"           (the pack lists its own)
    get.month.pay.act.info            para2, para3                  not read — see below
    get.hero.month.card.info          (none: Hero Code = 9008)      rewardArr[].reward, 30 days
    get.package.choose.activity.info  packageArr[].item (3rd field)  the picked hero's fragments

The last two (1.2.0, 2026-11-26) came from a sweep of what the store screens
ask for: most ask nothing and draw from these login answers. Hero Code's
answer carries no exchange id at all; the client's `hero_monthcard` table
maps every one of its 24 rows to exchange 9008, the only pack of type 666,
so the id is a constant here. The Choice Pack's answer lists nine heroes,
each with five tiers as "fragmentId;num;exchangeId;1|…"; `chooseId` is the
hero the account has picked, and only that hero's tiers are named — the
others are the same five packs with different fragments, not other offers.

WHAT IS INFERRED, NOT OBSERVED. Nobody has bought one of these with capture
on, so which pack unlocks which track rests on the names:
  - `exchangeId` ↔ `battlePass.unlock` ↔ the special track: the only paid
    track of a one-pack pass, so this one is safe.
  - `extExchangeId` ↔ `unlockMiddle` ↔ the middle track: by elimination (two
    packs, two flags, two paid tracks; the ext pack is the cheaper one).
  - a season pass's two `packageIds` ↔ `unlock` / `unlockBig` ↔ middle /
    special, in that order: the same elimination, by position.
  - whether the dearer pack ALSO pays the middle track is unknown; it is
    given the special track alone, so its value is a floor.
  - `get.month.pay.act.info`: `para2` / `para3` are two packs of one name, so
    they are recorded as sold here, but which of its 30 stages either one
    unlocks is not known and no contents are written.

Contents are the track's rewards summed over every level — what the pack
pays a buyer who finishes it. A weekly card's are its `reward` claimed once
a day for `time` days (1.1.0: the pack's own list is the "buy to instantly
get" part, which the view adds to this). Only reward type 7 (an item) is
counted; other types stay in `raw`.

Per-account progress (level, exp, claimed states, tasks) is left out of
`raw` and so out of the key. The key carries the capture DAY: a pack row is
then written once a day while its screen exists, and the day it stops being
written is the day the pack stopped being sold here (the view reads only the
newest days).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from dw_collector.models import NormalizedRow, Observation, entry_idempotency_key, stable_uuid
from dw_collector.registry import register

PARSER_VERSION = "1.2.0"
ITEM_REWARD = 7
# A weekly card's `time` is days; a value outside this is not a card we know.
MAX_CARD_DAYS = 400
# Hero Code's pack. The screen's answer names no exchange id; the client's
# `hero_monthcard` datatable (24 rows, every cycle since launch) says
# exchange 9008 for all of them, and 9008 is the catalog's one type-666 pack.
HERO_CODE_PACK_ID = "9008"


def _pack_id(value: Any) -> str | None:
    text = (
        str(value).strip() if isinstance(value, str | int) and not isinstance(value, bool) else ""
    )
    return text if text.isdigit() else None


def _split(value: Any) -> list[str]:
    """ "83103;83104" → ["83103", "83104"]; anything else → []."""
    if not isinstance(value, str):
        return []
    return [part.strip() for part in value.split(";") if part.strip().isdigit()]


def _reward_lists(levels: Any, field: str) -> list[list[Any]]:
    """The `field` reward list of every level, in order. A level without the
    list (or a malformed one) contributes nothing."""
    if not isinstance(levels, list):
        return []
    return [
        level[field]
        for level in levels
        if isinstance(level, dict) and isinstance(level.get(field), list) and level[field]
    ]


def _items(reward_lists: Iterable[list[Any]]) -> list[dict[str, Any]]:
    """Item rewards summed per item id, in first-seen order."""
    totals: dict[str, float] = {}
    for rewards in reward_lists:
        for reward in rewards:
            if not isinstance(reward, dict) or reward.get("type") != ITEM_REWARD:
                continue
            value = reward.get("value")
            if not isinstance(value, dict):
                continue
            item_id = _pack_id(value.get("id"))
            num = value.get("num")
            if item_id is None or isinstance(num, bool) or not isinstance(num, int | float):
                continue
            if num <= 0:
                continue
            totals[item_id] = totals.get(item_id, 0) + num
    return [
        {"id": item_id, "qty": int(qty) if qty == int(qty) else qty}
        for item_id, qty in totals.items()
    ]


def _row(
    observation: Observation,
    pack_id: str,
    *,
    activity_id: Any = None,
    track: str | None = None,
    rewards: list[list[Any]] | None = None,
    repeat: int = 1,
    extra: dict[str, Any] | None = None,
) -> NormalizedRow:
    """One offer row. `rewards` is a list of reward lists (one per level);
    `repeat` says how many times the whole list is paid (a weekly card's
    `reward` x its days), so items and levels are multiplied by it."""
    activity = _pack_id(activity_id)
    raw: dict[str, Any] = {"pack_id": pack_id, **(extra or {})}
    if activity is not None:
        raw["activityId"] = activity
    if track is not None:
        raw["track"] = track
        raw["rewards"] = rewards or []
        if repeat != 1:
            raw["repeat"] = repeat
    key = entry_idempotency_key(
        observation, f"offer:{pack_id}", observation.captured_at.date().isoformat(), raw
    )
    return NormalizedRow(
        target_table="shop_pack_offers",
        idempotency_key=key,
        row={
            "observation_id": str(observation.observation_id),
            "source_command": observation.source_command,
            "parser_version": PARSER_VERSION,
            "captured_at": observation.captured_at.isoformat(),
            "collector_id": str(observation.collector_id),
            "collected_from_server_id": observation.collected_from_server_id,
            "raw": raw,
            "snapshot_id": str(stable_uuid(key)),
            "server_id": observation.collected_from_server_id,
            "pack_id": pack_id,
            "activity_id": activity,
            "track": track,
            "items": _items((rewards or []) * repeat),
            "levels": len(rewards) * repeat if track is not None and rewards is not None else None,
        },
    )


def _unique(rows: list[NormalizedRow]) -> list[NormalizedRow]:
    """One row per pack: a response that names a pack twice says it once."""
    seen: set[str] = set()
    out: list[NormalizedRow] = []
    for row in rows:
        if row.idempotency_key not in seen:
            seen.add(row.idempotency_key)
            out.append(row)
    return out


@register("get.battlepass.info")
def normalize_battlepass(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    levels = payload.get("stateInfo")
    activity = payload.get("activityId")
    special = _reward_lists(levels, "specialReward")
    middle = _reward_lists(levels, "middleReward")
    rows: list[NormalizedRow] = []
    main = _pack_id(payload.get("exchangeId"))
    if main is not None:
        rows.append(_row(observation, main, activity_id=activity, track="special", rewards=special))
    ext = _pack_id(payload.get("extExchangeId"))
    if ext is not None:
        rows.append(_row(observation, ext, activity_id=activity, track="middle", rewards=middle))
    series = payload.get("seriesExchangeIds")
    for value in series if isinstance(series, list) else []:
        pack_id = _pack_id(value)
        if pack_id is not None:
            rows.append(
                _row(observation, pack_id, activity_id=activity, track="special", rewards=special)
            )
    return _unique(rows)


@register("get.season.battlepass.info")
def normalize_season_battlepass(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    ids = _split(payload.get("packageIds"))
    levels = payload.get("stateInfo")
    activity = payload.get("activityId")
    if len(ids) != 2:
        # Not the two-pack shape the tracks were matched on: sold here, but
        # no track is claimed for any of them.
        return _unique([_row(observation, i, activity_id=activity) for i in ids])
    return _unique(
        [
            _row(
                observation,
                ids[0],
                activity_id=activity,
                track="middle",
                rewards=_reward_lists(levels, "middleReward"),
            ),
            _row(
                observation,
                ids[1],
                activity_id=activity,
                track="special",
                rewards=_reward_lists(levels, "specialReward"),
            ),
        ]
    )


@register("growth.plan.info")
def normalize_growth_plan(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    pack_id = _pack_id(payload.get("exchangeId"))
    if pack_id is None:
        return []
    return [
        _row(
            observation,
            pack_id,
            track="special",
            rewards=_reward_lists(payload.get("stageInfo"), "specialReward"),
            extra={"rechargeType": payload.get("rechargeType")},
        )
    ]


@register("get.month.detect.card")
def normalize_month_detect_card(observation: Observation) -> list[NormalizedRow]:
    cards = observation.payload.get("monthDetectCards")
    rows: list[NormalizedRow] = []
    for card in cards if isinstance(cards, list) else []:
        if not isinstance(card, dict):
            continue
        pack_id = _pack_id(card.get("exchangeId"))
        if pack_id is None:
            continue
        rows.append(
            _row(
                observation,
                pack_id,
                activity_id=observation.payload.get("activityId"),
                track="paid",
                rewards=_reward_lists(card.get("scoreRewardArr"), "payReward"),
                extra={"cardType": card.get("cardType")},
            )
        )
    return _unique(rows)


def _card_days(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 1 <= value <= MAX_CARD_DAYS else None


@register("get.week.card.info")
def normalize_week_cards(observation: Observation) -> list[NormalizedRow]:
    """A card's `reward` is what it pays each day for `time` days — the part
    of a weekly pass the pack's own list (the instant grant) leaves out. A
    card without a reward list (the custom passes, whose days are picks made
    elsewhere) is named bare, as before."""
    cards = observation.payload.get("weekCards")
    rows: list[NormalizedRow] = []
    for card in cards if isinstance(cards, list) else []:
        pack_id = _pack_id(card.get("exchange_id")) if isinstance(card, dict) else None
        if pack_id is None:
            continue
        reward = card.get("reward")
        days = _card_days(card.get("time"))
        if isinstance(reward, list) and reward and days is not None:
            rows.append(
                _row(
                    observation,
                    pack_id,
                    track="daily",
                    rewards=[reward],
                    repeat=days,
                    extra={"card": card.get("id")},
                )
            )
        else:
            rows.append(_row(observation, pack_id, extra={"card": card.get("id")}))
    return _unique(rows)


@register("get.season.week.card.info")
def normalize_season_week_card(observation: Observation) -> list[NormalizedRow]:
    pack_id = _pack_id(observation.payload.get("exchangeId"))
    if pack_id is None:
        return []
    return [_row(observation, pack_id, activity_id=observation.payload.get("activityId"))]


@register("multi.choice.gift.info")
def normalize_multi_choice_gift(observation: Observation) -> list[NormalizedRow]:
    gifts = observation.payload.get("gifts")
    rows: list[NormalizedRow] = []
    for gift in gifts if isinstance(gifts, list) else []:
        pack_id = _pack_id(gift.get("exchangeId")) if isinstance(gift, dict) else None
        if pack_id is not None:
            rows.append(
                _row(observation, pack_id, activity_id=observation.payload.get("activityId"))
            )
    return _unique(rows)


@register("get.custom.package.activity.info")
def normalize_custom_package_activity(observation: Observation) -> list[NormalizedRow]:
    activity = observation.payload.get("activityId")
    return _unique(
        [
            _row(observation, pack_id, activity_id=activity)
            for pack_id in _split(observation.payload.get("exchangeIds"))
        ]
    )


@register("get.month.pay.act.info")
def normalize_month_pay(observation: Observation) -> list[NormalizedRow]:
    payload = observation.payload
    rows: list[NormalizedRow] = []
    for field in ("para2", "para3"):
        pack_id = _pack_id(payload.get(field))
        if pack_id is not None:
            rows.append(
                _row(
                    observation,
                    pack_id,
                    activity_id=payload.get("activityId"),
                    extra={"field": field},
                )
            )
    return _unique(rows)


@register("get.hero.month.card.info")
def normalize_hero_month_card(observation: Observation) -> list[NormalizedRow]:
    """Hero Code: a 30-day calendar, one reward list a day. `state` is the
    account's claim progress and `buy` whether it bought; neither is kept.
    The screen sends no exchange id (see HERO_CODE_PACK_ID)."""
    payload = observation.payload
    days = payload.get("rewardArr")
    if not isinstance(days, list) or not days:
        return []
    rewards = _reward_lists(days, "reward")
    if not rewards:
        return []
    return [
        _row(
            observation,
            HERO_CODE_PACK_ID,
            activity_id=payload.get("activityId"),
            track="daily",
            rewards=rewards,
        )
    ]


def _choice_tiers(spec: Any) -> list[tuple[str, str, float]]:
    """ "253072;10;25070701;1|253072;20;25070702;1" →
    [(pack "25070701", fragment "253072", 10.0), …]. The fourth field is
    always 1 and is not read."""
    out: list[tuple[str, str, float]] = []
    if not isinstance(spec, str):
        return out
    for part in spec.split("|"):
        fields = [f.strip() for f in part.split(";")]
        if len(fields) < 3 or not fields[0].isdigit() or not fields[2].isdigit():
            continue
        try:
            out.append((fields[2], fields[0], float(fields[1])))
        except ValueError:
            continue
    return out


@register("get.package.choose.activity.info")
def normalize_package_choose(observation: Observation) -> list[NormalizedRow]:
    """Exclusive Equipment Choice Pack: five tiers, each a pack, whose
    fragment depends on the hero picked (`chooseId`). The picked hero's
    tiers are named with that fragment as their contents; `buyExchangeArr`
    (what the account bought) is left out."""
    payload = observation.payload
    packages = payload.get("packageArr")
    chosen = str(payload.get("chooseId", "")).strip()
    if not isinstance(packages, list) or not chosen:
        return []
    picked = next(
        (p for p in packages if isinstance(p, dict) and str(p.get("id", "")).strip() == chosen),
        None,
    )
    if picked is None:
        return []
    rows: list[NormalizedRow] = []
    for pack_id, fragment, num in _choice_tiers(picked.get("item")):
        if num <= 0:
            continue
        rows.append(
            _row(
                observation,
                pack_id,
                activity_id=payload.get("activityId"),
                track="choice",
                rewards=[[{"type": ITEM_REWARD, "value": {"id": fragment, "num": num}}]],
                extra={"hero": chosen, "equip": picked.get("exclusive_equip")},
            )
        )
    return _unique(rows)
