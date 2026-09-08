-- 0168: anon holds NOTHING in public, not just nothing readable.
--
-- 0065 inverted the default and did it in three layers — policy, grant, test.
-- The grant layer was written as SELECT and only SELECT:
--
--   revoke select on all tables in schema public from anon;
--   alter default privileges in schema public revoke select on tables from anon;
--
-- Supabase's own default privileges grant anon the PostgREST set on every
-- table created in public. Revoking SELECT from that default leaves the rest
-- of it in place, so INSERT, UPDATE and DELETE survived — on the tables that
-- existed in 2026-08, and on every table and view created since, inherited
-- silently at CREATE time.
--
-- Ninety-five relations carry them today.
--
-- WHY NOBODY NOTICED, and the part worth fixing properly. 0065's test layer is
-- `34_no_public_read_test`, and it asks whether anon can READ. It walks every
-- relation in the schema, it has caught new tables exactly as designed, and it
-- passes with all ninety-five write grants in place, because a write grant is
-- not a read. The one assertion that ever saw this is in 87, which counts ANY
-- privilege and looks at one view. So this migration revokes the grants and
-- the next commit widens 34 to the question 0065 was actually asking.
--
-- WHAT THE EXPOSURE ACTUALLY IS, stated plainly rather than dramatised. It is
-- not a hole today:
--
--   * Every table in public has RLS enabled, and no policy names anon (34
--     asserts both). A grant without a policy writes nothing.
--   * Auto-updatable views are the way past RLS, because a view that is not
--     security_invoker runs as its owner. There is exactly one such view in
--     public — `notification_channel_names` — and 0125 revoked anon on it by
--     name.
--
-- So this is a missing guard rail rather than an open door: the next
-- owner-rights updatable view added without its own revoke would be writable
-- by anyone holding the publishable key, which is a key that ships in the
-- browser bundle. The rail is cheap and belongs where 0065 meant to put it.
--
-- Nothing here touches functions. `current_app_role`, `has_permission` and
-- `is_service_request` are granted to anon deliberately — RLS calls them
-- before a role exists — and 57_anon_callable_test is the file that watches
-- them. Sequences are left alone too, having been measured: anon holds no
-- privilege on any sequence in public.

-- The ninety-five that already have them.
revoke all on all tables in schema public from anon;

-- And everything created from here on. This is the line 0065 needed: revoking
-- SELECT from a default that grants four privileges leaves three behind.
alter default privileges in schema public revoke all on tables from anon;

-- Same reasoning as 0065's own attempt, and the same escape hatch: migrations
-- run as `postgres`, but an object created under `supabase_admin` would carry
-- that role's defaults instead. A hosted project's `postgres` may not be
-- allowed to alter another role's defaults, so this is attempted rather than
-- asserted — and 34 is what makes it safe either way.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
          'revoke all on tables from anon';
exception when insufficient_privilege or undefined_object then
  raise notice
    'could not alter supabase_admin default privileges; 34_no_public_read_test '
    'is the guard that matters';
end $$;
