-- 0309: where a player stands on their server, with both neighbours, in one row.
--
-- The profile's server-rank tile asked two head-count questions of `players`
-- (how many have more power; how many have any) and said "#12 of 1,840". The
-- header's verdict needs more than the place: "#12 on 580, 1.2M behind #11"
-- wants the power of the player just above, and "Strongest on 580 by 59.4M"
-- wants the one just below. Four requests for one sentence is the wrong shape;
-- this returns rank, total and both neighbours as one row.
--
-- RANK is "players on the same server with strictly more power, plus one", so
-- a tie shares the better place — unchanged from the tile. The neighbours are
-- the nearest DISTINCT powers above and below, so a tied player's gap to the
-- one above is real and not zero.
--
-- "Known" players only: `players.power` is what the collector has read, and a
-- null power is a player we have not ranked. Such a player gets no row rather
-- than rank 1 of one.
--
-- Invoker, over `players` as 0065 left it: member_read for authenticated
-- members, officers and admins; nothing for anon. So this widens nothing — a
-- viewer gets no row because the table shows them no rows, and anon has no
-- execute at all (0168: anon holds nothing in public). The pgTAP file proves
-- all three. Served by players_server_power_idx (0002).

create or replace function public.player_server_rank(p_player_id uuid)
returns table (
  rank integer,
  total integer,
  power bigint,
  next_above_power bigint,
  next_below_power bigint
)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p.server_id, p.power
    from public.players p
    where p.player_id = p_player_id
      and p.power is not null
  )
  select
    (count(*) filter (where o.power > me.power))::integer + 1,
    count(*)::integer,
    me.power,
    min(o.power) filter (where o.power > me.power),
    max(o.power) filter (where o.power < me.power)
  from me
  join public.players o
    on o.server_id = me.server_id
   and o.power is not null
  group by me.power
$$;

revoke all on function public.player_server_rank(uuid) from public, anon;
grant execute on function public.player_server_rank(uuid) to authenticated, service_role;

comment on function public.player_server_rank(uuid) is
  'Power rank of one player among the players read on their server, with the '
  'nearest distinct power above and below. One row; none when the player is '
  'unknown or has no power reading. Invoker over players, so it shows a reader '
  'exactly what the table does — see 0309.';
