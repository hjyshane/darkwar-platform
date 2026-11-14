-- 0324: the ping, the expiry, and who may read delivery state.
--
-- pg_net is not in the local stub, so the POST itself is not run here. That is
-- why delivery is split: `alert_payload` builds what is posted, `next_alerts`
-- picks what is posted, `expire_stale_alerts` drops what is too late to post —
-- all three plain SQL, all three tested below. deliver_owned_alerts only wires
-- them to http_post.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
delete from public.app_settings where key = 'own_alliance';
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000324a1', 580, 'ext-deliver', 'DeliverTest', true, 2);
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000324a1"}');
select public.resolve_own_alliance();
-- A second alliance of ours, so a member of ONLY that one has a different
-- active alliance from the first.
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000324a2', 581, 'ext-deliver-2', 'DeliverOther', true, 1);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000324f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliver-member@test.invalid'),
  ('00000000-0000-4000-8000-000000324f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliver-other@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-000000324f01', 'member', 'deliver member'),
  ('00000000-0000-4000-8000-000000324f02', 'member', 'deliver other');
delete from public.alliance_memberships
 where user_id in ('00000000-0000-4000-8000-000000324f01', '00000000-0000-4000-8000-000000324f02');
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-000000324f01', '00000000-0000-4000-8000-0000000324a1', 'member'),
  ('00000000-0000-4000-8000-000000324f02', '00000000-0000-4000-8000-0000000324a2', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.schedule_events (schedule_event_id, alliance_id, title, starts_at)
values ('00000000-0000-4000-8000-0000000324e1', '00000000-0000-4000-8000-0000000324a1',
        'deliver entry', now() + interval '2 days');

insert into public.notification_channels (channel, webhook_url, enabled) values
  ('t324-on', 'https://discord.invalid/on', true),
  ('t324-off', 'https://discord.invalid/off', false);

-- Ten old rows on a channel that is switched off, then one sendable row.
insert into public.notification_outbox (channel, event, idempotency_key, title, body, created_at)
select 't324-off', 'schedule_reminder', 'alarm:t324:off:' || g, 'off ' || g, 'b',
       now() - interval '1 day' + g * interval '1 second'
from generate_series(1, 10) g;
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, created_at, ping_role_id, expires_at,
   schedule_event_id, alarm_step, anchor_at)
values ('t324-on', 'schedule_reminder', 'alarm:t324:sendable', 'BG · A', 'x',
        now() - interval '1 hour', '123456789012345678', now() + interval '10 minutes',
        '00000000-0000-4000-8000-0000000324e1', 'start:60', now() + interval '1 hour');

-- 20 minutes past its time (expiry is 15 minutes after it): stale.
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, created_at, expires_at,
   schedule_event_id, alarm_step, anchor_at)
values ('t324-on', 'schedule_reminder', 'alarm:t324:stale', 'late', 'x',
        now() - interval '30 minutes', now() - interval '5 minutes',
        '00000000-0000-4000-8000-0000000324e1', 'start:30', now() + interval '1 hour');
-- Already sent, already in flight: past their expiry but not expirable.
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, expires_at, delivered_at)
values ('t324-off', 'schedule_reminder', 'alarm:t324:sent', 'sent', 'x',
        now() - interval '5 minutes', now() - interval '20 minutes');
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, expires_at, transport_request_id)
values ('t324-off', 'schedule_reminder', 'alarm:t324:flying', 'flying', 'x',
        now() - interval '5 minutes', 987654);
-- Not expiring rows: a fresh alarm, and an alert that has no expiry at all.
insert into public.notification_outbox (channel, event, idempotency_key, title, body, expires_at)
values ('t324-off', 'schedule_reminder', 'fresh', 'fresh', 'x', now() + interval '10 minutes');
insert into public.notification_outbox (channel, event, idempotency_key, title, body, created_at)
values ('t324-off', 'sync_stalled', 'sync-stalled', 'stalled', 'x', now() - interval '3 days');
-- A moved-notice style row: no step, so it is not an alarm delivery.
insert into public.notification_outbox
  (channel, event, idempotency_key, title, body, schedule_event_id)
values ('t324-off', 'schedule_reminder', 'moved:t324', 'moved', 'x',
        '00000000-0000-4000-8000-0000000324e1');

-- ------------------------------------------------------------- the payload

select is(internal.alert_payload('BG · A', 'x', '123456789012345678') -> 'allowed_mentions',
  '{"parse": [], "roles": ["123456789012345678"]}'::jsonb, 'only the board role can be pinged');
select is(internal.alert_payload('BG · A', 'x', '123456789012345678') ->> 'content',
  '<@&123456789012345678> BG · A', 'the ping names the event');
select ok(not (internal.alert_payload('BG · A', 'x', null) ? 'content'),
  'no role: no content, no ping');
select is(internal.alert_payload('t', '@everyone come', null) -> 'allowed_mentions',
  '{"parse": []}'::jsonb, '@everyone in a message notifies nobody');
select is(internal.alert_payload('BG', 'the text', null) -> 'embeds' -> 0 ->> 'description',
  'the text', 'the embed still carries the body');
select ok(length(internal.alert_payload(repeat('x', 3000), 'b', '123456789012345678') ->> 'content') <= 2000,
  'a long title cannot push content past 2000 characters');

-- ------------------------------------------------------------ next_alerts

select is((select array_agg(notification_id) from internal.next_alerts(10)),
  array[(select notification_id from public.notification_outbox where idempotency_key = 'alarm:t324:sendable')],
  'ten older rows on a disabled channel, and an unswept stale one, do not starve a sendable one');
select is((select payload ->> 'content' from internal.next_alerts(10)),
  '<@&123456789012345678> BG · A', 'next_alerts carries the finished payload');

-- ----------------------------------------------------------- expire_stale

select is(internal.expire_stale_alerts(), 1, 'one alarm 20 minutes past its time expires');
select is((select expired_at is not null and last_error = 'expired: not sent within 15 minutes of its time'
             from public.notification_outbox where idempotency_key = 'alarm:t324:stale'),
  true, 'and says why');
select is((select expired_at is null from public.notification_outbox where idempotency_key = 'fresh'),
  true, 'a fresh alarm does not');
select is((select expired_at is null from public.notification_outbox where idempotency_key = 'sync-stalled'),
  true, 'an alert with no expiry never expires');
select is((select count(*)::int from public.notification_outbox
            where idempotency_key in ('alarm:t324:sent', 'alarm:t324:flying') and expired_at is not null),
  0, 'a delivered or in-flight row is left alone');
select is(internal.expire_stale_alerts(), 0, 'a second sweep finds nothing');

-- Re-enable the channel: the stale row must still not be sent, the rest are.
update public.notification_channels set enabled = true where channel = 't324-off';
select ok(not exists (select 1 from internal.next_alerts(50) n
                       join public.notification_outbox o using (notification_id)
                      where o.idempotency_key = 'alarm:t324:stale'),
  'an expired alarm is never offered for sending');

-- ------------------------------------------------------------------- grants

select ok(not has_function_privilege('authenticated', 'internal.next_alerts(int)', 'execute')
      and not has_function_privilege('authenticated', 'internal.expire_stale_alerts()', 'execute')
      and not has_function_privilege('authenticated', 'internal.deliver_owned_alerts(int)', 'execute'),
  'the delivery functions are not callable by API roles');

-- -------------------------------------------------------- alarm_deliveries

select pg_temp.act_as('00000000-0000-4000-8000-000000324f01');
set local role authenticated;
select is((select count(*)::int
             from public.alarm_deliveries(array['00000000-0000-4000-8000-0000000324e1'::uuid])),
  2, 'members read delivery state of their alliance (steps only, not the moved notice)');
select is((select alarm_step from public.alarm_deliveries(array['00000000-0000-4000-8000-0000000324e1'::uuid])
            where expired_at is not null),
  'start:30', 'and see which step expired');
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-000000324f02');
set local role authenticated;
select is((select count(*)::int
             from public.alarm_deliveries(array['00000000-0000-4000-8000-0000000324e1'::uuid])),
  0, 'another alliance reads nothing');
reset role;

set local role anon;
select throws_ok($$ select * from public.alarm_deliveries(array['00000000-0000-4000-8000-0000000324e1'::uuid]) $$,
  '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
