-- 0084: how big the board was that ranked this player.
--
-- Same defect 0081 fixed for alliances, in the other history view: a rank with no
-- denominator. "Rank 32" reads as excellent or dismal depending on whether the
-- board held 40 entries or 150, and the chart had no way to say which.
--
-- WHAT THE PLAYER BOARDS ACTUALLY ARE, measured rather than assumed, because the
-- names mislead:
--
--   `server.rank`  ranks by POWER. Despite the name it is NOT one server — every
--                  captured reading spans 7 to 12 servers (577–588) and holds 150
--                  entries, of which about 10 are ours.
--   `kill.rank`    ranks by KILLS. Also cross-server, also 150.
--
-- So `player_snapshots.rank` is fed by two boards measuring two different
-- quantities, and the trend chart drew both as one line: our own R4 alternated
-- between 32 and 104 every minute, one reading apart. That is not a data fault and
-- it is not one number moving — it is a power rank and a kill rank, both true.
-- Splitting them is the client's job (`source_command` was already exposed); this
-- adds the denominator neither had.
--
-- NO WITHIN-OUR-SERVER RANK IS DERIVED, and that is deliberate. It looks available
-- — take the 10 rows from 580 in a reading and number them — but "2nd of the 580
-- players who reached a twelve-server top 150" is not "2nd on server 580", and it
-- would be read as the second. Server 580 has hundreds of players and most never
-- appear on this board at all. A single-server player board would have to be
-- captured before that line could be drawn honestly.
create or replace view public.player_power_history
with (security_invoker = true) as
select
  player_id,
  server_id,
  captured_at,
  power,
  hq_level,
  kills,
  rank,
  source_command,
  -- The reading this row arrived in, so a client can tell 32nd of 150 from 32nd of
  -- 40. Counted over the observation rather than stored, for the same reason as
  -- 0081: it is not in the payload, it is a property of the capture.
  count(*) over (partition by observation_id) as board_size
from public.player_snapshots;

comment on view public.player_power_history is
  'Every captured player reading, with the size of the board it came from. '
  '`source_command` distinguishes the two boards, which measure DIFFERENT things: '
  'server.rank is power and kill.rank is kills, both cross-server over 577-588. '
  'Drawn as one line they look like a player swinging 70 places a minute.';
