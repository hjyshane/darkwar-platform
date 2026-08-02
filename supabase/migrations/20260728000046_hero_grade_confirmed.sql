-- 0046: the last two grades, from the game.
--
-- 0043 left 1015 Cecilia and 32001 Musashimaru null because the counting
-- could not separate them. Six of the seven heroes that are Lv40, outside
-- the training centre and unequipped are 파랑 and exactly one is 보라, and
-- the clue meant to tell them apart — that the 보라 one is a Shooter — fit
-- both, since both are recorded as Shooters.
--
-- The user read it off the game: Cecilia is the Shooter the clue meant. So
-- Cecilia is the 보라, and Musashimaru is the sixth 파랑.
--
-- That completes the count 0043 derived rather than assumed: 노랑 7 +
-- 보라 14 + 파랑 6 = 27 owned, which is what was reported from the game
-- before any of these rows existed.
--
-- One loose thread worth naming rather than quietly fixing: the clue
-- separated the pair BY CLASS, and both are recorded as Shooter. Either the
-- clue meant something narrower than the class column, or 32001's class is
-- wrong. Neither is settled here, and the class column is left as the user
-- entered it — this migration only fills in the grades.

update public.heroes set grade = 2 where hero_id = 1015 and grade is null;
update public.heroes set grade = 1 where hero_id = 32001 and grade is null;
