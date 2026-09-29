-- 0202: the activity screen names an account by its character in the
-- alliance on screen, not by the one display character it has.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

update public.alliances set is_own = false, roster_unredacted_seen = false
 where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000ba001', 580, 'ext-an-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000ba002', 581, 'ext-an-b', 'Bravo', 'BBB');

delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000ba001",
                                           "00000000-0000-4000-8000-0000000ba002"]}');

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000ba201', 580, 9250000000000001, 'an admin char a',
   '00000000-0000-4000-8000-0000000ba001'),
  ('00000000-0000-4000-8000-0000000ba202', 580, 9250000000000002, 'an both char a',
   '00000000-0000-4000-8000-0000000ba001'),
  ('00000000-0000-4000-8000-0000000ba203', 581, 9250000000000003, 'an both char b',
   '00000000-0000-4000-8000-0000000ba002');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ba101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'an-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000ba102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'an-both@test.invalid');
-- The display character is Alpha's for both; the member of both also has a
-- Bravo character linked.
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000ba101', 'admin', 'an admin account',
   '00000000-0000-4000-8000-0000000ba201'),
  ('00000000-0000-4000-8000-0000000ba102', 'member', 'an both account',
   '00000000-0000-4000-8000-0000000ba202');
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000ba203', '00000000-0000-4000-8000-0000000ba102')
on conflict do nothing;
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000ba102', '00000000-0000-4000-8000-0000000ba002', 'member');

create function pg_temp.as_admin(p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', '00000000-0000-4000-8000-0000000ba101')::text, true),
         set_config('request.headers',
           json_build_object('x-alliance-id', p_alliance)::text, true);
$$;

create function pg_temp.name_of(p_user uuid) returns text language sql as $$
  select display_name from public.activity_members where user_id = p_user
$$;

set local role authenticated;

select pg_temp.as_admin('00000000-0000-4000-8000-0000000ba001');
-- 1. On Alpha, the admin is its Alpha character, as before.
select is(pg_temp.name_of('00000000-0000-4000-8000-0000000ba101'), 'an admin char a',
  'on Alpha the admin is named by its Alpha character');
-- 2. And the member of both by their Alpha character.
select is(pg_temp.name_of('00000000-0000-4000-8000-0000000ba102'), 'an both char a',
  'and the member of both by theirs');

select pg_temp.as_admin('00000000-0000-4000-8000-0000000ba002');
-- 3. On Bravo, the admin has no character there: the account's name, not Alpha's character.
select is(pg_temp.name_of('00000000-0000-4000-8000-0000000ba101'), 'an admin account',
  'on Bravo an admin with no character there shows the account name, not its Alpha character');
-- 4. The member of both shows their Bravo character.
select is(pg_temp.name_of('00000000-0000-4000-8000-0000000ba102'), 'an both char b',
  'and the member of both shows their Bravo character');
reset role;

select * from finish();
rollback;
