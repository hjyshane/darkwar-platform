-- 0043: the hero's grade — 파랑 / 보라 / 노랑.
--
-- The catalogue has carried the grade in `notes` as prose since 0040, which
-- is fine for a person reading one row and useless for anything else: the
-- dashboard cannot colour by it, the admin form cannot offer it as a choice,
-- and nothing stops two rows from spelling it differently.
--
-- Numbers, not text, and ordered low to high the way the game orders them —
-- 파랑 1, 보라 2, 노랑 3. Labels live in the dashboard beside TROOP_CLASSES
-- for the same reason those do: they were read off a screen, not decoded, and
-- a schema is the wrong place to keep a translation.
--
-- Unconstrained beyond "positive", matching troop_class. A fourth grade is
-- the kind of thing a season ships, and it should arrive as a row somebody
-- can type rather than as a failed insert on the admin page.
alter table public.heroes
  add column grade smallint check (grade is null or grade > 0);

comment on column public.heroes.grade is
  '1 파랑 · 2 보라 · 3 노랑, the game''s own order. Null means nobody has '
  'established it yet — the catalogue never guesses a grade.';

-- The seed. Two of these are confirmed outright and the rest are derived, so
-- the derivation is written down where it can be checked:
--
--   노랑   전용무기가 있거나 Lv103. Nothing else in the roster is either, and
--          the user confirmed two of them from the game — the 시즌1 파이터
--          at 4.4성 (1004) and the 시즌1 라이더 at 3.2성 (33003).
--   파랑   Lv40 · 훈련소 밖 · 장비 없음
--   보라   훈련소에 있는 나머지 전부, + 33005 (사용자가 보라라고 확인)
--
-- It reconciles exactly against what the user counted in game: 노랑 7 +
-- 보라 14 + 파랑 6 = 보유 27. An assignment that was merely plausible would
-- not have to add up, so the arithmetic is doing real work here.
--
-- 1015 Cecilia and 32001 Musashimaru are left NULL on purpose. They are the
-- two heroes the reconciliation cannot separate — one of them is the single
-- 보라 outside the training centre and the other is 파랑, and the clue that
-- was meant to tell them apart (that one is a Shooter) turned out to fit
-- both. An admin sets them in one click; a guess here would be indelible.
update public.heroes set grade = v.grade
from (values
  -- 노랑
  ( 1004, 3), (11001, 3), (21001, 3), (33003, 3),
  (40001, 3), (40002, 3), (40003, 3),
  -- 보라
  ( 1002, 2), ( 1003, 2), ( 1006, 2), ( 1008, 2), ( 1012, 2), ( 1016, 2),
  ( 1017, 2), ( 1018, 2), ( 1019, 2), (12001, 2), (22001, 2), (22002, 2),
  (33001, 2), (33005, 2),
  -- 파랑
  ( 1007, 1), ( 1011, 1), ( 1021, 1), (22003, 1), (33002, 1)
) as v(hero_id, grade)
where public.heroes.hero_id = v.hero_id
  and public.heroes.grade is null;
