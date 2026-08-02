-- 0022: a favourites list is private to its owner, and the shape cannot
-- express a favourite that points at nothing or at two things at once.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   is_super_admin, confirmation_token, recovery_token)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated',
  'authenticated', u.email, '', now(), now(), now(), '{}', '{}',
  false, '', ''
from (values
  ('00000000-0000-4000-8000-00000000b001'::uuid, 'owner@test.local'),
  ('00000000-0000-4000-8000-00000000b002'::uuid, 'nosy@test.local')
) as u(id, email);

-- Owner's list, seeded as postgres so the negatives below cannot pass
-- against an empty table.
-- Its own player to favourite. Borrowing a seeded one meant this inserted
-- nothing at all once the seed was cleared for real captures, and "the owner
-- sees their own list" failed against an empty list rather than a hidden one.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000ad401', 580, 58009401, 'FavouriteOnly');

insert into public.favourites (user_id, player_id)
values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000ad401');

select throws_ok($$
  insert into public.favourites (user_id) values ('00000000-0000-4000-8000-00000000b001')
$$, '23514', null, 'a favourite must point at something');

select throws_ok($$
  insert into public.favourites (user_id, server_id, alliance_id)
  select '00000000-0000-4000-8000-00000000b001', 580, alliance_id
  from public.alliances limit 1
$$, '23514', null, 'a favourite cannot point at two things at once');

set local role authenticated;

-- owner
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}', true);

select isnt_empty($$ select * from public.favourites $$,
  'the owner sees their own list');

select lives_ok($$
  insert into public.favourites (user_id, server_id)
  values ('00000000-0000-4000-8000-00000000b001', 580)
$$, 'the owner can add to their own list');

select throws_ok($$
  insert into public.favourites (user_id, server_id)
  values ('00000000-0000-4000-8000-00000000b001', 580)
$$, '23505', null, 'the same server cannot be favourited twice');

-- Writing into someone else's list is what `with check` exists to stop; a
-- policy with only `using` would allow it.
select throws_ok($$
  insert into public.favourites (user_id, server_id)
  values ('00000000-0000-4000-8000-00000000b002', 581)
$$, '42501', null, 'the owner cannot plant a favourite in another list');

-- nosy
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000b002","role":"authenticated"}', true);

select is_empty($$ select * from public.favourites $$,
  'another member sees none of it');

select lives_ok($$ delete from public.favourites $$,
  'a delete that matches nothing is not an error');

reset role;
select isnt_empty($$ select * from public.favourites $$,
  'and that delete removed nothing, because none of it was theirs');

select * from finish();
rollback;
