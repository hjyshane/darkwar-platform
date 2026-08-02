-- 0039: how to find each hero on a game screen, so the ids can be named.
--
-- 0037 shipped a catalogue with 28 ids and no names and assumed somebody
-- could fill them in. They could not: an id is not something the game ever
-- shows you, so "which hero is 12001" has no answer on any screen.
--
-- What the game does show is position and progress, and `init` carries both
-- for the collector's own account. Three lists, none of them names, each of
-- them readable straight off a screen:
--
--   schoolPositions    15 heroes, each in a numbered training-centre slot
--   heroIntensifys     19 heroes with their enhancement level
--   heroEquipUniques    6 heroes with an exclusive weapon and its level
--
-- Together they pin 25 of the 27 owned heroes. The last two, 1021 and 33002,
-- appear in none of the three — which is itself the clue, since they are the
-- only heroes below maximum star without an exclusive weapon, and their
-- promotion steps (3 and 1) tell them apart.
--
-- Collisions were checked rather than assumed. Two heroes share enhancement
-- 13 (1011, 11001) and two share weapon level 26 (1004, 40001); in both
-- cases the existing columns separate them — class for the first pair, star
-- for the second. Every row below is unique against the game screen.
--
-- These are notes about ONE account on ONE day, not facts about the game.
-- They belong in `notes` — free text the catalogue accumulates — precisely
-- because they are disposable: the admin form edits name and notes in the
-- same action, so whoever types the name clears the hint that led them to it.
-- 33005 gets none, because the collector does not own it; it is the hero
-- other players field six times and this account has never seen up close.

update public.heroes set notes = v.hint
from (values
  ( 1002, '학교 2번 · 강화 41'),
  ( 1003, '학교 12번 · 강화 3'),
  ( 1004, '전용무기 lv26 · 4성 2단계'),
  ( 1006, '학교 9번 · 강화 44'),
  ( 1007, '강화 23'),
  ( 1008, '학교 4번 · 강화 33'),
  ( 1011, '강화 13 (파이터)'),
  ( 1012, '학교 11번 · 강화 17'),
  ( 1015, '강화 32'),
  ( 1016, '학교 6번 · 강화 42'),
  ( 1017, '학교 14번 · 강화 18'),
  ( 1018, '학교 7번 · 강화 50'),
  ( 1019, '학교 1번 · 강화 102'),
  ( 1021, '4성 3단계 · 전용무기 없음'),
  (11001, '강화 13 (슈터)'),
  (12001, '학교 15번 · 강화 56'),
  (21001, '전용무기 lv30'),
  (22001, '학교 10번 · 강화 8'),
  (22002, '학교 5번 · 강화 104'),
  (22003, '강화 19'),
  (32001, '강화 25'),
  (33001, '학교 13번 · 강화 40'),
  (33002, '4성 1단계 · 전용무기 없음'),
  (33003, '학교 8번 · 전용무기 lv22 · 3성 1단계'),
  (40001, '전용무기 lv26 · 5성'),
  (40002, '전용무기 lv27'),
  (40003, '학교 3번 · 전용무기 lv16')
) as v(hero_id, hint)
where public.heroes.hero_id = v.hero_id
  -- Only where nobody has written anything. A hint must never overwrite a
  -- note somebody put there themselves.
  and public.heroes.notes = '';
