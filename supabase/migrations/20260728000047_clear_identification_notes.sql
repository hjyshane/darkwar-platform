-- 0047: clear the identification hints. They did their job.
--
-- 0039 through 0042 seeded `notes` with how to find each hero on a game
-- screen — training-centre slot, Hall of Honor level, exclusive weapon —
-- because 0037 had shipped a catalogue of ids that nobody could match to a
-- hero. Every one of the 28 is named now, and the pets with them, so the
-- hints are directions to a place everyone has already arrived at.
--
-- 0039 said this would happen: "the admin form edits name and notes in the
-- same action, so whoever types the name clears the hint that led them to
-- it." It turned out to be quicker to clear them all at once.
--
-- Matched by the shapes those migrations wrote rather than by "everything",
-- so a note somebody has typed since survives — `notes` stays as the free
-- text the catalogue accumulates, it is only the seeded breadcrumbs that go.
--
-- Nothing is lost with them. The Catherine / Catherine & Rex relationship
-- that 0042 put in two of these rows is written up in docs/handover.md and
-- in 0042's own comment, which is where a fact about the game belongs; a
-- note on a row is where a reminder belongs, and this stopped being one.

update public.heroes set notes = ''
where notes <> ''
  and (notes like '훈련소%'
       or notes like '전용무기%'
       or notes like '명예의 전당%'
       or notes like '4성%'
       or notes like '보라(중간) 등급%');

update public.pets set notes = ''
where notes in ('order unconfirmed', 'added recently')
   or notes like 'observed %';
