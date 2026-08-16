-- 0125: the name is readable, the URL is not.
--
-- The whole point of this view is a narrowing, and a narrowing is the kind of
-- change that is easy to write and easy to write too wide. The assertion that
-- matters is not "an officer can read it" — it is that the same officer still
-- cannot reach the table underneath, because a view that leaks its base table's
-- privileges hands out a webhook URL, and a webhook URL is a standing licence
-- to post to the alliance's channel under the alliance's own name.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000cd001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chan-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000cd002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'chan-member@test.invalid');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000cd001', 'officer'),
  ('00000000-0000-4000-8000-0000000cd002', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.notification_channels (channel, webhook_url)
values ('alarm', 'https://discord.test/webhooks/secret-alarm');

-- ------------------------------------------------------------------- the shape
select hasnt_column(
  'public', 'notification_channel_names', 'webhook_url',
  'the URL is not a column here - a filter somebody can forget is not the '
  'same as a column that does not exist');

-- ----------------------------------------------------------------- the officer
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000cd001');

select is(
  (select channel from public.notification_channel_names),
  'alarm',
  'an officer can list the names, which is what makes the board editor fillable');

-- ZERO ROWS, not a refusal, and the difference is worth writing down because
-- the first version of this test asserted 42501 and failed. 0076 grants
-- `select` on `notification_channels` to `authenticated` and then filters with
-- an RLS POLICY, so a non-admin is not refused — they are handed nothing. Both
-- keep the URL away from an officer; only one of them is what actually happens,
-- and a test that asserts the wrong mechanism will pass or fail for reasons
-- that have nothing to do with the URL being safe.
select is(
  (select count(*) from public.notification_channels),
  0::bigint,
  'and still gets nothing at all from the table underneath - the view granted '
  'a name, not the credential beside it');

-- ------------------------------------------------------------------ the member
select pg_temp.act_as('00000000-0000-4000-8000-0000000cd002');

select is(
  (select count(*) from public.notification_channel_names),
  0::bigint,
  'a member sees no channel names - they cannot write a board, so the list '
  'would only tell them where announcements come from');

reset role;

-- -------------------------------------------------------------------- the door
select throws_ok(
  $$ set local role anon; select count(*) from public.notification_channel_names $$,
  '42501',
  NULL,
  'anon cannot read it at all - not an empty list, a refusal');

reset role;

select is(
  (select count(*) from public.notification_channel_names),
  1::bigint,
  'the notifier still sees it, so nothing here breaks the delivery path');

select * from finish();
rollback;
