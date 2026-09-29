-- 0199: each alliance's events go to that alliance's Discord, a new alliance
-- starts with nothing switched on, and a primary swap keeps both routings.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000b7001', 580, 'ext-dc-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000b7002', 581, 'ext-dc-b', 'Bravo', 'BBB');

delete from public.app_settings where key in ('own_alliance', 'discord_notifications');
-- Alpha's routing, in the shared row, before Bravo exists as ours.
insert into public.app_settings (key, value)
values ('discord_notifications',
        '{"player_claim": {"enabled": true, "channel": "dc-a-claims"}}');
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000b7001"]}');

-- 1-2. Pin Bravo as well: it gets routing of its own, and it is EMPTY.
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000b7001",
                               "00000000-0000-4000-8000-0000000b7002"]}'
where key = 'own_alliance';
select is(
  (select value from public.alliance_settings
    where alliance_id = '00000000-0000-4000-8000-0000000b7002' and key = 'discord_notifications'),
  '{}'::jsonb,
  'a newly pinned alliance starts with no Discord routing — not a copy of the primary''s');
select is(internal.alert_channel('player_claim', '00000000-0000-4000-8000-0000000b7002'), null,
  'so its claims go nowhere, rather than into the primary''s room');

-- 3. The primary's routing is unchanged.
select is(internal.alert_channel('player_claim', '00000000-0000-4000-8000-0000000b7001'),
  'dc-a-claims', 'the primary routes by app_settings, as before');

-- Bravo's officers choose their own room.
update public.alliance_settings
set value = '{"player_claim": {"enabled": true, "channel": "dc-b-claims"}}'
where alliance_id = '00000000-0000-4000-8000-0000000b7002' and key = 'discord_notifications';

-- 4-5. The claim detector sends each claim to its own alliance's channel.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000b7101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dc-a@test.invalid'),
  ('00000000-0000-4000-8000-0000000b7102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dc-b@test.invalid');
insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000b7201', 580, 9240000000000001, 'dc alpha player'),
  ('00000000-0000-4000-8000-0000000b7202', 581, 9240000000000002, 'dc bravo player');
insert into public.player_claims (user_id, player_id, status, alliance_id)
values
  ('00000000-0000-4000-8000-0000000b7101', '00000000-0000-4000-8000-0000000b7201', 'pending',
   '00000000-0000-4000-8000-0000000b7001'),
  ('00000000-0000-4000-8000-0000000b7102', '00000000-0000-4000-8000-0000000b7202', 'pending',
   '00000000-0000-4000-8000-0000000b7002');

select internal.detect_player_claims();
select is(
  (select channel from public.notification_outbox
    where idempotency_key like 'player_claim:00000000-0000-4000-8000-0000000b7101:%'),
  'dc-a-claims', 'Alpha''s claim goes to Alpha''s channel');
select is(
  (select channel from public.notification_outbox
    where idempotency_key like 'player_claim:00000000-0000-4000-8000-0000000b7102:%'),
  'dc-b-claims', 'Bravo''s claim goes to Bravo''s channel');

-- Channels, one per alliance. Names stay unique across the install.
insert into public.notification_channels (channel, webhook_url, alliance_id)
values
  ('dc-a-news', 'https://discord.invalid/a', '00000000-0000-4000-8000-0000000b7001'),
  ('dc-b-news', 'https://discord.invalid/b', '00000000-0000-4000-8000-0000000b7002');

-- 6-7. A post may name its own alliance's channel, not the other's.
select lives_ok(
  $$ insert into public.announcements (title, body, alliance_id, channels)
     values ('dc bravo post', '', '00000000-0000-4000-8000-0000000b7002', array['dc-b-news']) $$,
  'a Bravo post may announce in a Bravo channel');
select throws_ok(
  $$ insert into public.announcements (title, body, alliance_id, channels)
     values ('dc smuggled', '', '00000000-0000-4000-8000-0000000b7002', array['dc-a-news']) $$,
  '23503', null,
  'but not in Alpha''s');

-- 8-9. An admin viewing Bravo manages Bravo's channels and no others.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000b7103', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'dc-admin@test.invalid');
insert into public.app_users (user_id, role) values ('00000000-0000-4000-8000-0000000b7103', 'admin');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000b7103')::text, true);
select set_config('request.headers',
  json_build_object('x-alliance-id', '00000000-0000-4000-8000-0000000b7002')::text, true);
select is(
  (select array_agg(channel order by channel) from public.notification_channels
    where channel like 'dc-%'),
  array['dc-b-news'], 'an admin viewing Bravo sees Bravo''s webhooks');
select is(
  (select array_agg(channel order by channel) from public.notification_channel_names
    where channel like 'dc-%'),
  array['dc-b-news'], 'and an editor there is offered Bravo''s channel names only');
reset role;
select set_config('request.jwt.claims', '{}', true),
       set_config('request.headers', '{}', true);

-- Bravo turns reminders and sign-up alerts on, into its own rooms.
update public.alliance_settings
set value = '{"player_claim": {"enabled": true, "channel": "dc-b-claims"},
              "schedule_reminder": {"enabled": true, "channel": "dc-b-news"},
              "new_signup": {"enabled": true, "channel": "dc-b-news"}}'
where alliance_id = '00000000-0000-4000-8000-0000000b7002' and key = 'discord_notifications';

-- 13. A board may not point at another alliance's webhook.
select throws_ok(
  $$ insert into public.schedule_categories (category, label, channel, alliance_id)
     values ('dc-bravo-war', 'War', 'dc-a-news', '00000000-0000-4000-8000-0000000b7002') $$,
  '23503', null,
  'a Bravo board cannot name an Alpha channel');

-- 14. And one that already does (written before the check existed) is not
-- obeyed: Bravo's reminder goes to Bravo's routing, not Alpha's room.
alter table public.schedule_categories disable trigger channel_is_ours;
insert into public.schedule_categories (category, label, channel, alliance_id)
values ('dc-legacy', 'Legacy', 'dc-a-news', '00000000-0000-4000-8000-0000000b7002');
alter table public.schedule_categories enable trigger channel_is_ours;
insert into public.schedule_events (schedule_event_id, title, starts_at, category, alliance_id)
values ('00000000-0000-4000-8000-0000000b7301', 'dc bravo rally', now() + interval '1 minute',
        'dc-legacy', '00000000-0000-4000-8000-0000000b7002');
insert into public.schedule_reminders (schedule_event_id, minutes_before)
values ('00000000-0000-4000-8000-0000000b7301', 1);
select internal.detect_schedule_reminders();
select is(
  (select channel from public.notification_outbox
    where idempotency_key like 'schedule_reminder:%' and title = 'dc bravo rally'),
  'dc-b-news', 'a reminder never follows a board into another alliance''s room');

-- 15. A sign-up is announced to the alliance it asked for — and a malformed
-- request (the user writes their own metadata) does not break the detector.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000b7104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dc-wants-b@test.invalid',
   '{"alliance_id": "00000000-0000-4000-8000-0000000b7002"}'),
  ('00000000-0000-4000-8000-0000000b7105', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dc-junk@test.invalid',
   '{"alliance_id": "not-a-uuid"}');
select internal.detect_new_signups();
select is(
  (select channel from public.notification_outbox
    where idempotency_key = 'new_signup:00000000-0000-4000-8000-0000000b7104'),
  'dc-b-news', 'a sign-up for Bravo is announced in Bravo''s room');

-- 10-12. Swap the primary: each alliance keeps the routing it had.
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000b7002",
                               "00000000-0000-4000-8000-0000000b7001"]}'
where key = 'own_alliance';
select is(internal.alert_channel('player_claim', '00000000-0000-4000-8000-0000000b7001'),
  'dc-a-claims', 'the demoted primary keeps its routing — it is not reset to empty');
select is(internal.alert_channel('player_claim', '00000000-0000-4000-8000-0000000b7002'),
  'dc-b-claims', 'and the promoted one keeps its own');
select is(
  (select value -> 'player_claim' ->> 'channel' from public.app_settings
    where key = 'discord_notifications'),
  'dc-b-claims', 'which is now the shared row');

select * from finish();
rollback;
