-- 0065: the default flips. Nothing in this app is public any more.
--
-- Until now the schema's answer to "who may read this?" was "everyone,
-- unless a migration said otherwise", and eighteen tables carried a
-- `public_read ... using (true)` policy. Every new table inherited that
-- posture by default, so the safe outcome depended on somebody remembering.
-- 0064 closed the arena that way — one table at a time, after counting what
-- was exposed. That does not scale to "and everything added from now on".
--
-- So the default is inverted. Three layers, because each fails differently:
--
--   1. POLICY. Every public_read becomes member_read. A signed-in VIEWER is
--      excluded too — signing in is not the gate, holding the role is.
--   2. GRANT. anon loses SELECT on everything in public, and loses it by
--      default on tables created later. A policy edit cannot re-open what
--      the grant refuses, and anon gets 42501 rather than an empty list,
--      which is a louder and more honest failure.
--   3. TEST. 34_no_public_read_test walks every relation in the schema and
--      fails if anon can read any of it. That is the layer that catches the
--      NEXT table, which is the actual request — the other two only fix
--      today's.
--
-- What stays reachable signed out: the login screen and the join-code flow,
-- which run through GoTrue and a security-definer function rather than
-- through table reads. A new account is a `viewer` with no rows until an
-- admin or a join code makes it a member. That is the intended front door
-- and this migration does not touch it.
--
-- `announcements` loses the meaning of its `visibility` column for readers:
-- 'public' no longer widens anything, because there is no public. The column
-- stays — it still records intent, and re-deriving it later from nothing
-- would be impossible — but nothing reads it to grant access now.

-- 1. Policies.
--
-- ONLY the blanket ones — `using (true)`. That restriction is the whole
-- safety of this loop and was learned the hard way: a first version matched
-- every SELECT policy naming anon, which swept up two that are not blanket
-- at all. `player_month_cards.admin_read` is written `for select to anon,
-- authenticated using (current_app_role() = 'admin')` — it names anon and
-- refuses everyone but an admin — and replacing it with a member policy
-- would have WIDENED who can see who pays, in a migration whose entire
-- purpose is to narrow. 12_month_card_admin_test caught it.
--
-- So: `qual = 'true'` and nothing else. The two policies with a real
-- predicate are handled below, by name, where the reasoning is visible.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and cmd = 'SELECT'
      and 'anon' = any(roles) and qual = 'true'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy member_read on public.%I for select to authenticated '
      'using (public.current_app_role() in (''member'', ''officer'', ''admin''))',
      r.tablename);
  end loop;
end $$;

-- announcements: `public_read` let anyone read a notice marked
-- visibility='public'. Dropped outright rather than replaced — the table
-- already has `member_read`, keyed on the announcement.read capability,
-- which is narrower and configurable from the admin grid.
drop policy public_read on public.announcements;

-- player_month_cards: admin-only already. It names anon only because it was
-- written before `to authenticated` was the habit, and with the grant
-- revoked below that clause does nothing. Narrowed to authenticated so the
-- policy says what it means, and the predicate is untouched.
drop policy admin_read on public.player_month_cards;
create policy admin_read on public.player_month_cards
  for select to authenticated
  using (public.current_app_role() = 'admin');

-- 2. Grants, present and future.
revoke select on all tables in schema public from anon;

-- Views do not have RLS. For the two that run as the invoker the underlying
-- policies would stop anon anyway, but sync_status is security_invoker=false
-- and runs as its owner — for that one the grant is the ONLY gate, so this
-- line is not belt-and-braces, it is the belt.
revoke select on public.sync_status from anon;
revoke select on public.alliance_latest from anon;
revoke select on public.player_power_growth from anon;

-- Tables created from here on. Migrations run as `postgres`, whose default
-- ACL already withholds SELECT from anon; `supabase_admin`'s does not, and
-- anything created under that role would arrive world-readable. Both are
-- revoked, and the supabase_admin one is attempted rather than asserted
-- because a hosted project's `postgres` may not be allowed to alter another
-- role's defaults. The test in 34 is what makes this safe either way: if the
-- revoke did not take, the next table to appear fails CI rather than the
-- internet.
alter default privileges in schema public revoke select on tables from anon;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke select on tables from anon';
exception when insufficient_privilege or undefined_object then
  raise notice
    'could not alter supabase_admin default privileges; 34_no_public_read_test '
    'is the guard that matters';
end $$;

comment on column public.announcements.visibility is
  'Whether a notice was written for everyone or for members. Since 0065 no '
  'reader is anonymous, so this no longer widens access — it records what '
  'the author meant, and nothing reads it to grant.';
