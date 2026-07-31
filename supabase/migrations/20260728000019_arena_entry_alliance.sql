-- 0019: the alliance an arena opponent belongs to.
--
-- `user.get.arena.info` already tells us. Each rankArr entry carries
-- `alName` and `abbr` alongside `serverId`, and the parser was dropping
-- both into `raw` — so the data has been arriving since the first capture,
-- it just never reached a column or a screen.
--
-- TEXT, not a reference to public.alliances. The payload gives a name and a
-- tag but no alliance id, and matching on name is not sound: names change,
-- and two servers in the group can run alliances with the same tag. What is
-- stored here is therefore *what the arena response said this player's
-- alliance was called at that moment*, which is exactly the right grain for
-- a snapshot table. Resolving it to an alliance_id would need the id, and
-- the id is not in this response.
--
-- Both columns nullable: an unallied player has neither, and the fields are
-- absent rather than empty when that happens.

alter table public.arena_entries add column alliance_name text;
alter table public.arena_entries add column alliance_code text;

comment on column public.arena_entries.alliance_name is
  'alName from the arena response — the alliance name as reported at capture '
  'time, not a resolved reference to public.alliances (the payload has no id).';

comment on column public.arena_entries.alliance_code is
  'abbr from the arena response: the short tag shown in-game, e.g. CBFW.';

-- Backfill from the payloads already journalled, so existing rows gain the
-- columns rather than waiting for the next capture. Only where the key is
-- actually present: a missing alName must stay null, not become ''.
update public.arena_entries
set alliance_name = nullif(raw ->> 'alName', ''),
    alliance_code = nullif(raw ->> 'abbr', '')
where raw ? 'alName' or raw ? 'abbr';

-- Arena boards are read per week and scanned by alliance ("who from LovE is
-- in the top 100"), so the tag is worth an index. server_id leads it: the
-- group grows to 12/16/32/64 servers and every hot index starts there.
create index arena_entries_alliance_idx
  on public.arena_entries (server_id, alliance_code, captured_at desc);
