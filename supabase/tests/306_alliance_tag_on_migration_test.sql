-- 0306: the Migration screens' alliance carries its tag.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is(public.alliance_label('Crew', 'CRW'), '[CRW] Crew', 'tag before the name');
select is(public.alliance_label('Crew', null), 'Crew', 'name alone without a tag');
select is(public.alliance_label(null, 'CRW'), 'CRW', 'tag alone without a name');
select is(public.alliance_label(' ', ''), null, 'null for neither');

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000a9001', 'tag-test');
insert into public.servers (server_id, server_group) values (570, 'test'), (571, 'test')
on conflict do nothing;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-0000000a9a01', 570, 'ext-tag-roster', 'TagCrew', 'TGC'),
  ('00000000-0000-4000-8000-0000000a9a02', 570, 'ext-tag-none', 'NoTagCrew', null);
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a9b01', 571, 9362000000000571, 'Tagged'),
  ('00000000-0000-4000-8000-0000000a9b02', 571, 9363000000000571, 'Untagged');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id, name,
   power, presence_redacted)
values
  (gen_random_uuid(), 'al.rank', 't', 'tag:r1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000a9001', 570, '00000000-0000-4000-8000-0000000a9a01', 570,
   9362000000000571, '00000000-0000-4000-8000-0000000a9b01', 'Tagged', 800, true),
  (gen_random_uuid(), 'al.rank', 't', 'tag:r2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000a9001', 570, '00000000-0000-4000-8000-0000000a9a02', 570,
   9363000000000571, '00000000-0000-4000-8000-0000000a9b02', 'Untagged', 700, true);

select is((select alliance_name from public.migration_movers(570, 571, 570, 571) where name = 'Tagged'),
          '[TGC] TagCrew', 'a roster mover shows the alliance tag first');
select is((select alliance_name from public.migration_movers(570, 571, 570, 571) where name = 'Untagged'),
          'NoTagCrew', 'and just the name when the alliance has no tag');

-- A state list names the tag `abbr`; the lookup behind it is gated to officers.
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a9b03', 570, 9364000000000571, 'Listed'),
  ('00000000-0000-4000-8000-0000000a9b04', 570, 9365000000000571, 'ListedBare');
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, raw)
values
  ('00000000-0000-4000-8000-0000000a9c01', 'cross.server.rank', 't', 'tag:s1', now(),
   '00000000-0000-4000-8000-0000000a9001', 570, '00000000-0000-4000-8000-0000000a9b03', 570,
   9364000000000571, 'Listed', 900, '{"allianceName": "ListCrew", "abbr": "LST"}'),
  ('00000000-0000-4000-8000-0000000a9c01', 'cross.server.rank', 't', 'tag:s2', now(),
   '00000000-0000-4000-8000-0000000a9001', 570, '00000000-0000-4000-8000-0000000a9b04', 570,
   9365000000000571, 'ListedBare', 850, '{"allianceName": "BareCrew"}');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a9f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tag-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a9f01', 'officer');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a9f01')::text, true);

select is((select alliance_name from public.migration_movers(570, 571, 570, 571) where name = 'Listed'),
          '[LST] ListCrew', 'a state-list mover shows the list''s tag first');
select is((select alliance_name from public.migration_movers(570, 571, 570, 571) where name = 'ListedBare'),
          'BareCrew', 'and the name alone when the list gave no tag');

select * from finish();
rollback;
