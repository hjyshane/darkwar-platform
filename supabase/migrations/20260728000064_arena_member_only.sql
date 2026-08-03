-- 0064: the arena moves behind the member gate, before anything is public.
--
-- Counted against the real data with an anon session, a stranger with the
-- URL could read 3,998 rows of arena defence lineups — every hero, star,
-- weapon and piece of equipment on every board we have captured, ours
-- included. The same facts are visible in game by opening the rankings, but
-- one screen at a time; as an endpoint it is a download, and the difference
-- is the whole point. This is a decision taken before going public rather
-- than a leak found afterwards (docs/runbooks/going-public.md, step 0).
--
-- All four arena tables, not the two that carry lineups. arena_entries
-- alone names who is on the board with what defence power, and
-- arena_snapshots plus arena_matches say when and against which servers.
-- Leaving any of them public would mean the gate reads as closed while the
-- interesting half stays open.
--
-- `to authenticated` and not merely a role check: a policy restricted to
-- authenticated never runs for anon at all, which is one fewer way for a
-- future edit to the USING clause to matter.
--
-- The collector is unaffected. It writes with the service key, which
-- bypasses RLS; sync does not read these tables back.

drop policy public_read on public.arena_snapshots;
drop policy public_read on public.arena_entries;
drop policy public_read on public.arena_entry_heroes;
drop policy public_read on public.arena_matches;

create policy member_read on public.arena_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.arena_entries
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.arena_entry_heroes
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.arena_matches
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- The tab, so the screen is not offered to someone who would only see it
-- empty. Its own capability rather than reusing members.view: an admin may
-- reasonably want the roster open to the alliance and the arena narrower,
-- or the reverse, and one row is the cheapest way to leave that open.
insert into public.capabilities (capability, label, description, sort_order)
values
  ('arena.view', 'See the Arena screen',
   'Weekly boards and the defence lineups on them. The RLS on the arena '
   'tables is what actually withholds the data; this decides whether the '
   'tab is offered.', 6);

insert into public.role_permissions (role, capability, allowed) values
  ('viewer', 'arena.view', false),
  ('member', 'arena.view', true),
  ('officer', 'arena.view', true),
  ('admin', 'arena.view', true);

comment on table public.arena_entry_heroes is
  'Decoded defence lineups. Member-only since 0064 — as an endpoint this is '
  'a scouting download, not a screen. Read by the arena board and the '
  'player page, both of which are gated on arena.view.';
