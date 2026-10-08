-- 0244: a login with every squad empty does not erase the last filled squads;
-- the other columns still come from the newest snapshot.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000d1001', 'squads-test');
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000d1201', 580, 9310000000000581, 'filled char'),
  ('00000000-0000-4000-8000-0000000d1202', 580, 9310000000001581, 'never char');

insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   hero_squads, hero_levels)
values
  (gen_random_uuid(), 'init', '1.5.0', 'd1-test:1', '2026-10-06 02:00+00',
   '00000000-0000-4000-8000-0000000d1001', 580, 580,
   '00000000-0000-4000-8000-0000000d1201', 9310000000000581,
   '[{"index":1,"heroes":[40006,1016]},{"index":2,"heroes":[]}]', '{"40006": 100}'),
  (gen_random_uuid(), 'init', '1.5.0', 'd1-test:2', '2026-10-07 21:00+00',
   '00000000-0000-4000-8000-0000000d1001', 580, 580,
   '00000000-0000-4000-8000-0000000d1201', 9310000000000581,
   '[{"index":1,"heroes":[]},{"index":2,"heroes":[]}]', '{"40006": 110}'),
  (gen_random_uuid(), 'init', '1.5.0', 'd1-test:3', '2026-10-07 21:00+00',
   '00000000-0000-4000-8000-0000000d1001', 580, 580,
   '00000000-0000-4000-8000-0000000d1202', 9310000000001581,
   '[{"index":1,"heroes":[]}]', '{}');

select is((select hero_squads from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000d1201'),
  '[{"index":1,"heroes":[40006,1016]},{"index":2,"heroes":[]}]'::jsonb,
  'an all-empty newest login keeps the last filled squads');
select is((select (hero_levels ->> '40006')::int from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000d1201'), 110,
  'while other columns come from the newest snapshot');
select is((select captured_at from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000d1201'),
  timestamptz '2026-10-07 21:00+00', 'and captured_at is the newest snapshot''s');
select is((select hero_squads from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000d1202'),
  '[{"index":1,"heroes":[]}]'::jsonb,
  'a player who never had a filled squad keeps the empty value');

select * from finish();
rollback;
