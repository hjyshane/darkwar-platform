-- 0017: fill the pass column for rows normalized before the pass existed.
--
-- The promotion in 0011 handled data flowing FORWARD: parsers ≥1.1.0 emit
-- month_card_expires_at, triggers project it. But the edge journal keeps
-- normalized rows as they were parsed at capture time, and the idempotency
-- key deliberately survives parser upgrades (it hashes the raw payload) —
-- so a journal full of 1.0.0 rows re-syncs with the typed column null and
-- the cloud ignores the "duplicate". The value was never lost, though:
-- `raw` keeps the whole payload, which is exactly why the conventions
-- store it.
--
-- A FUNCTION rather than a one-shot statement, because this situation
-- recurs by design: any pre-promotion journal syncing into a fresh
-- database (a db reset, a new environment) reopens the same hole, and
-- future promotions of other fields will face the same shape. Run it
-- after such a sync; it is idempotent.
--
-- The rules mirror dw_collector.fields.month_card_expires_at, and the
-- pgTAP file pins them so the two cannot drift silently:
--   * -1 and 0 are "no pass" sentinels, not timestamps;
--   * the value is epoch SECONDS — a millisecond-magnitude value (>1e11,
--     i.e. past year 5138) means a confused payload and is refused rather
--     than becoming a date in the far future.

create function public.backfill_month_card_from_raw()
returns table (member_rows bigint, player_rows bigint, cards bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_member bigint;
  n_player bigint;
  n_cards bigint;
begin
  update public.alliance_member_snapshots
  set month_card_expires_at = to_timestamp((raw ->> 'monthCardEndTime')::bigint)
  where month_card_expires_at is null
    and raw ->> 'monthCardEndTime' ~ '^[0-9]+$'
    and (raw ->> 'monthCardEndTime')::bigint > 0
    and (raw ->> 'monthCardEndTime')::bigint < 100000000000;
  get diagnostics n_member = row_count;

  update public.player_snapshots
  set month_card_expires_at = to_timestamp((raw ->> 'monthCardEndTime')::bigint)
  where month_card_expires_at is null
    and raw ->> 'monthCardEndTime' ~ '^[0-9]+$'
    and (raw ->> 'monthCardEndTime')::bigint > 0
    and (raw ->> 'monthCardEndTime')::bigint < 100000000000;
  get diagnostics n_player = row_count;

  -- Project into the secured summary the same way the triggers do:
  -- newest reading per player wins, an older one never overwrites.
  insert into public.player_month_cards (player_id, expires_at, observed_at)
  select distinct on (player_id) player_id, month_card_expires_at, captured_at
  from (
    select player_id, month_card_expires_at, captured_at
    from public.alliance_member_snapshots
    where player_id is not null and month_card_expires_at is not null
    union all
    select player_id, month_card_expires_at, captured_at
    from public.player_snapshots
    where player_id is not null and month_card_expires_at is not null
  ) readings
  order by player_id, captured_at desc
  on conflict (player_id) do update
    set expires_at = excluded.expires_at, observed_at = excluded.observed_at
    where public.player_month_cards.observed_at < excluded.observed_at;
  get diagnostics n_cards = row_count;

  return query select n_member, n_player, n_cards;
end;
$$;

-- Operator tooling, not client surface: the whole point of 0016 was that
-- clients cannot read raw, so nothing callable by them may interpret it.
revoke all on function public.backfill_month_card_from_raw() from public, anon, authenticated;

-- Cover rows that synced before this migration ran.
select * from public.backfill_month_card_from_raw();
