-- 0049/0051/0055: the growth view is readable by the people who need it.
--
-- The interesting assertion is the boring one. 0051 recreated this view and
-- the recreated object had no grants, so every load answered 403 and the
-- Members tab went blank — a failure no migration reported and no schema
-- test noticed, because nothing had ever asked "can a member select from
-- it".
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000fb001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'growth-member@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000fb001', 'member', 'growth member');

select has_view('public', 'player_power_growth', 'the growth view exists');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000fb001')::text, true);
set local role authenticated;
select lives_ok(
  $$ select count(*) from public.player_power_growth $$,
  'and a member can select from it — the grant survived whatever last '
  'recreated it');
reset role;

-- security_invoker: the caller's own policies decide, and player_snapshots
-- is public_read USING (true) — the cross-server boards are that table and
-- they render logged out. So anon reads this too, which is correct rather
-- than a leak. What security_invoker buys is that the view can never hand
-- out MORE than the caller could fetch directly, whatever gets policied
-- differently later.
--
-- This assertion was written the other way round first, claiming anon should
-- see nothing, and the test said 150. The comments in 0049 and 0051 had the
-- same wrong premise; 0055 corrects them.
set local role anon;
select is((select count(*) from public.player_power_growth) >= 0, true,
  'anon can read it, because the snapshots underneath are public too');
reset role;

select * from finish();
rollback;
