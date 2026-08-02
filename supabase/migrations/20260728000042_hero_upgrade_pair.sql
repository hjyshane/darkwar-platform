-- 0042: 33005 and 1017 are one character at two upgrade stages.
--
-- Reported from the game: 33005 is Catherine, a mid-grade hero, and paying to
-- upgrade her produces 1017 Catherine & Rex — the original is consumed, so an
-- account holds one or the other and never both. Same standing as the troop
-- class labels: read off the screen by the person playing, not decoded.
--
-- This explains the thing 0037 could not. 33005 was the one hero in the
-- catalogue that the collector does not own while other players field it, and
-- that looked like a gap in one account's roster. It is not a gap: this
-- account upgraded, so it has 1017 instead.
--
-- The captured lineups DO NOT confirm it, and saying so is the point. 33005
-- appears in 3 of 156 distinct lineups against 1017's 38, so independence
-- predicts 0.7 shared lineups and zero were seen — a result that arises about
-- half the time by chance. Both are Fighters, and three of a class earns a
-- bonus, so if anything the synergy rule should push them together rather
-- than apart, which makes the zero mildly interesting and still not evidence.
-- The upgrade claim rests on the user's reading, not on this.
--
-- What it changes: the catalogue holds 28 ENTRIES, not 28 characters. Any
-- count of "how many heroes exist" has to say which it means, and any future
-- pairing found this way needs the same caveat about the sample.

update public.heroes set notes = '보라(중간) 등급 · 유료 업그레이드하면 1017 Catherine & Rex가 되고 원본은 사라진다 · 수집 계정은 업그레이드해서 미보유'
where hero_id = 33005 and notes = '';

update public.heroes set notes = '훈련소 14번 · 33005 Catherine의 업그레이드 형태 (원본은 소멸하므로 한 계정이 둘 다 갖지 않는다)'
where hero_id = 1017 and notes = '훈련소 14번';
