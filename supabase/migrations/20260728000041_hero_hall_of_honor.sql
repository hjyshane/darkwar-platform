-- 0041: `heroIntensifys` is the Hall of Honor level. Confirmed, and the last
-- two ambiguous pairs fall out of it.
--
-- 0039 guessed this field was 강화 and printed the number. 0040 pulled it
-- because the guess had no evidence — 11001 reads level 103 in army.info and
-- heroIntensifys 13 in the same init, so it was not the level either. The
-- user then read it off the game: it is the **Hall of Honor** level, which a
-- hero enters after reaching five stars.
--
-- Everything in the payload agrees, and it agrees on the part that would
-- have caught a wrong answer:
--
--   all 19 heroes carrying the field are at rankLv 6, the maximum star
--   none of the 4 below maximum star carry it at all
--
-- That is the "after five stars" rule stated in data. The four maxed heroes
-- with no entry — 21001, 40001, 40002, 40003 — simply have not been put in
-- yet, which is a state, not a contradiction: absence here means "not
-- entered", the same way a null weapon means "not unlocked".
--
-- So the number goes back into the hints, and this time it is named. It also
-- settles both pairs 0040 had to leave open, because in each pair the Hall of
-- Honor level is the one thing that differs:
--
--   1007 / 1011    both Fighter, Lv40, unequipped, maxed — 23 vs 13
--   1015 / 32001   neither ever fielded, so no class either — 32 vs 25
--
-- The 15 training-centre heroes keep their slot number as the primary clue.
-- A slot on screen beats a number inside a screen, and it does not go stale
-- when somebody levels a hero up.

update public.heroes set notes = v.hint
from (values
  ( 1007, '명예의 전당 23 · Lv40 · 장비 없음 · 파이터'),
  ( 1011, '명예의 전당 13 · Lv40 · 장비 없음 · 파이터'),
  ( 1015, '명예의 전당 32 · Lv40 · 장비 없음 · 병종 미관측'),
  (32001, '명예의 전당 25 · Lv40 · 장비 없음 · 병종 미관측'),
  (22003, '명예의 전당 19 · Lv40 · 장비 없음 · 라이더'),
  (11001, '명예의 전당 13 · 노랑 · 슈터 · Lv103 · 전용무기 없음')
) as v(hero_id, hint)
where public.heroes.hero_id = v.hero_id
  -- Only rows still carrying 0040's placeholder. Anything a person has
  -- written since — including a name they worked out another way — stays.
  -- Parenthesised deliberately: AND binds tighter than OR, so without these
  -- the second pattern escapes the join and the statement matches every hero
  -- against every hint row.
  and (public.heroes.notes like 'Lv40%'
       or public.heroes.notes like '노랑 · 슈터%');

comment on column public.heroes.notes is
  'Free text. Seeded with how to find each hero on a game screen, since the '
  'hero_id appears nowhere in game; overwrite freely once the name is in.';
