-- 0040: take the guess out of the hero hints.
--
-- 0039 labelled `init.heroIntensifys[].lv` as 강화 and printed it as the
-- identifying clue for 19 heroes. That label was the payload's key name
-- translated, not something anyone had read off a screen, and this repo has
-- a rule about exactly that. The user asked what it meant, which is the
-- question a guess cannot survive.
--
-- It is not the hero's level, and that is settled rather than suspected:
-- 11001 reads level 103 in army.info — the collector's own lineup, already
-- cross-checked when 2.2 was named — and carries heroIntensifys 13 in the
-- same `init`. Two different numbers for one hero, so one of them is not the
-- level. What it actually is remains unknown, so it is no longer printed.
--
-- Everything below is verified against the game screen. The check that made
-- it trustworthy: hero 22002 (훈련소 5번) was read in game as Victor, Rider,
-- 손 노랑 lv32 · 머리 노랑 lv10 · 몸 보라 lv0 · 다리 보라 lv0 — and
-- init.heroEquips gives that hero 410100 lv32, 410300 lv10, 310400 lv0,
-- 310200 lv0. Exact match, including the grade in the id's first digit
-- (4 = 노랑, 3 = 보라).
--
-- Skills were NOT used. The same check showed them at 24/18/27/1 in a
-- capture three days old against 25/20/27/1 on screen: they drift, so they
-- identify a hero today and mislead next week.
--
-- Hero grade is derivable and reconciles exactly with what the user
-- reported — 노랑 7 + 중간 14 + 파랑 6 = 27 owned:
--
--   노랑   전용무기가 있거나 Lv103. 다른 어떤 영웅도 둘 중 하나에 해당하지 않는다
--   파랑   Lv40 · 훈련소 밖 · 장비 없음
--   중간   훈련소 13기 + 위 조건을 만족하지 않는 Lv40 한 기
--
-- Two pairs stay genuinely ambiguous and say so rather than pretending:
-- 1007/1011 (둘 다 파이터·Lv40·장비 없음·5성) and 1015/32001 (둘 다 병종
-- 미관측). The user reported that exactly one 중간등급 영웅은 훈련소 밖에
-- 있고 슈터이며 장비가 없다, which is one of 1015/32001 — the payload cannot
-- say which, because neither has ever been fielded in a captured lineup.

update public.heroes set notes = v.hint
from (values
  -- 훈련소. 슬롯 번호가 화면에 그대로 있으므로 다른 단서가 필요 없다.
  ( 1019, '훈련소 1번'),
  ( 1002, '훈련소 2번'),
  (40003, '훈련소 3번 · 노랑 · 전용무기 lv16'),
  ( 1008, '훈련소 4번'),
  (22002, '훈련소 5번'),
  ( 1016, '훈련소 6번'),
  ( 1018, '훈련소 7번'),
  (33003, '훈련소 8번 · 노랑 · 전용무기 lv22 · 3성대'),
  ( 1006, '훈련소 9번'),
  (22001, '훈련소 10번'),
  ( 1012, '훈련소 11번'),
  ( 1003, '훈련소 12번'),
  (33001, '훈련소 13번'),
  ( 1017, '훈련소 14번'),
  (12001, '훈련소 15번'),

  -- 노랑, 훈련소 밖. 전용무기 레벨이 서로 다르고 병종이 겹치는 곳에서는
  -- 성급이 갈라준다.
  ( 1004, '노랑 · 파이터 · Lv103 · 전용무기 lv26 · 5성 아님'),
  (40001, '노랑 · 파이터 · Lv103 · 전용무기 lv26 · 5성'),
  (21001, '노랑 · 슈터 · Lv103 · 전용무기 lv30'),
  (40002, '노랑 · 슈터 · Lv103 · 전용무기 lv27'),
  (11001, '노랑 · 슈터 · Lv103 · 전용무기 없음'),

  -- Lv40 · 훈련소 밖 · 장비 없음. 성급이 남은 것을 갈라준다.
  ( 1021, 'Lv40 · 장비 없음 · 5성 아님 (둘 중 더 올라간 쪽)'),
  (33002, 'Lv40 · 장비 없음 · 5성 아님 (둘 중 덜 올라간 쪽)'),
  (22003, 'Lv40 · 장비 없음 · 라이더'),
  ( 1007, 'Lv40 · 장비 없음 · 파이터 — 1011과 화면상 구분되지 않음'),
  ( 1011, 'Lv40 · 장비 없음 · 파이터 — 1007과 화면상 구분되지 않음'),
  ( 1015, 'Lv40 · 장비 없음 · 병종 미관측 — 32001과 함께, 한쪽이 중간등급 슈터'),
  (32001, 'Lv40 · 장비 없음 · 병종 미관측 — 1015와 함께, 한쪽이 중간등급 슈터')
) as v(hero_id, hint)
where public.heroes.hero_id = v.hero_id
  -- 0039 자기가 쓴 것만 덮어쓴다. 사람이 손댄 메모는 건드리지 않는다.
  and (public.heroes.notes = '' or public.heroes.notes like '%강화%'
       or public.heroes.notes like '학교%');
