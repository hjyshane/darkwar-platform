-- 0061: the hero catalogue as it now stands, so it survives a reset.
--
-- 0037 seeded ids and the classes the captures could prove, and left the
-- names blank because the protocol carries none. The user then read all 28
-- off the game and typed them in — and that work lived in one local
-- database and nowhere else. `supabase db reset` ate it twice during this
-- work, and would eat it again on any other machine, because a name typed
-- into a table is not part of the schema.
--
-- It is settled data now, not somebody's work in progress: every id has a
-- name, every class is confirmed, and the grades reconcile against the
-- counts the user reported (노랑 7 + 보라 14 + 파랑 6 = 27 owned, plus
-- 33005 which nobody here owns). So it belongs in a migration, where a
-- fresh checkout on another machine gets it for free.
--
-- Only fills blanks. `where ... is null` throughout, so a later correction
-- made through the admin page is never overwritten by replaying this.
update public.heroes set
  name = coalesce(public.heroes.name, v.name),
  troop_class = coalesce(public.heroes.troop_class, v.troop_class),
  grade = coalesce(public.heroes.grade, v.grade)
from (values
  ( 1002, 'Liz',             1::smallint, 2::smallint),
  ( 1003, 'Evans',           2, 2),
  ( 1004, 'Tristan',         1, 3),
  ( 1006, 'Guy',             1, 2),
  ( 1007, 'Bob',             1, 1),
  ( 1008, 'Farhad',          1, 2),
  ( 1011, 'Selena',          1, 1),
  ( 1012, 'Quinn',           3, 2),
  ( 1015, 'Cecilia',         2, 2),
  ( 1016, 'Eddie',           3, 2),
  ( 1017, 'Catherine & Rex', 1, 2),
  ( 1018, 'Kylie',           2, 2),
  ( 1019, 'Andre',           2, 2),
  ( 1021, 'Joe',             3, 1),
  (11001, 'Megan',           2, 3),
  (12001, 'Barnett',         1, 2),
  (21001, 'Natasha',         2, 3),
  (22001, 'Corleone',        3, 2),
  (22002, 'Victor',          3, 2),
  (22003, 'Ruby',            3, 1),
  (32001, 'Musashimaru',     2, 1),
  (33001, 'Scarlett',        3, 2),
  (33002, 'Willow',          2, 1),
  (33003, 'Cyrus',           3, 3),
  (33005, 'Catherine',       1, 2),
  (40001, 'Francis',         1, 3),
  (40002, 'Margaret',        2, 3),
  (40003, 'Marcia',          3, 3)
) as v(hero_id, name, troop_class, grade)
where public.heroes.hero_id = v.hero_id;

-- The one formula anybody wrote, as a starting point rather than a rule.
-- Every document in docs/ refers to "Activity Score" by name; a fresh
-- database with no such column made those references point at nothing.
insert into public.app_settings (key, value) values (
  'member_formulas',
  '{"formulas": [{"id": "formula:f4af4375-e4c5-412e-9695-12a30b64abb0",
                  "label": "Activity Score", "compact": true,
                  "expression": "(weekly_donation * 0.4) + (duel_weekly * 0.6)"}]}'::jsonb
) on conflict (key) do nothing;
