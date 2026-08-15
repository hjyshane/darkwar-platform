-- 0116: keeping a post, which is the thing `favourites` already does.
--
-- Scrapping a guide and starring a player are one feature with two nouns: a
-- private shortcut back to something, visible to nobody else. 0022 called that
-- table "per-user shortcuts" and gave it a nullable column per target with an
-- exactly-one check; a post is the fourth and fifth target, not a new idea.
--
-- A SEPARATE `post_scraps` TABLE WAS THE ALTERNATIVE AND IT LOSES. It would
-- copy 0022's policy, its partial-unique trick and its hook, and it would give
-- these two boards a THIRD near-identical per-user table beside `post_reads`
-- and `post_comments` — three places to look when somebody asks what the
-- database knows about a member and a post.
alter table public.favourites
  add column guide_id uuid references public.guides (guide_id) on delete cascade,
  add column announcement_id uuid
    references public.announcements (announcement_id) on delete cascade;

-- The check has to be replaced rather than added to: it names every target and
-- a second check would let a row set one of each and satisfy both.
alter table public.favourites drop constraint favourites_exactly_one_target;

alter table public.favourites add constraint favourites_exactly_one_target check (
  (player_id is not null)::int
  + (alliance_id is not null)::int
  + (server_id is not null)::int
  + (guide_id is not null)::int
  + (announcement_id is not null)::int = 1
);

-- Partial, for 0022's stated reason: with nulls in the other four columns a
-- plain unique would let the same post be scrapped repeatedly.
create unique index favourites_guide_uniq
  on public.favourites (user_id, guide_id) where guide_id is not null;
create unique index favourites_announcement_uniq
  on public.favourites (user_id, announcement_id) where announcement_id is not null;

comment on table public.favourites is
  'Per-user shortcuts: starred players, alliances and servers, and scrapped '
  'notices and guides. Private to their owner — the RLS policy is the only '
  'thing standing between one member''s list and another''s.';

-- NO POLICY CHANGE, AND THAT IS THE POINT OF REUSING THE TABLE. `own_favourites`
-- is `for all` on `user_id = auth.uid()` in both directions, so the two new
-- columns arrive already private. A new table would have needed that written
-- again and tested again.
--
-- No grant change either: `select, insert, delete` to authenticated already
-- covers it, and there is deliberately still no UPDATE — a shortcut is added
-- or removed, never edited.
