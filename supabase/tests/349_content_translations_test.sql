-- 0349: translations are cached where only the Edge Function (service role)
-- can reach them. A member who can read a notice still cannot read its
-- translations directly, and nobody but the service role can write one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0349', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'translate-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000a0349', 'member', 'translate member');

set local role service_role;
insert into public.content_translations
  (kind, source_id, field, language, source_hash, translated, model, requested_by)
values
  ('notice', '00000000-0000-4000-8000-0000000b0349', 'body', 'ko',
   repeat('a', 64), '번역된 공지', 'test-model', '00000000-0000-4000-8000-0000000a0349');
reset role;

-- 1-3. Refusals first: a member and anon read nothing and write nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a0349')::text, true);
set local role authenticated;
select throws_ok(
  'select count(*) from public.content_translations',
  '42501', null,
  'a member cannot read cached translations directly');
select throws_ok(
  $$insert into public.content_translations
      (kind, source_id, field, language, source_hash, translated, model)
    values ('notice', gen_random_uuid(), 'body', 'de', repeat('b', 64), 'x', 'm')$$,
  '42501', null,
  'a member cannot write a translation');
reset role;

set local role anon;
select throws_ok(
  'select count(*) from public.content_translations',
  '42501', null,
  'anon cannot read cached translations');
reset role;

-- 4. The service role reads what it wrote.
set local role service_role;
select is(
  (select translated from public.content_translations
    where kind = 'notice' and source_id = '00000000-0000-4000-8000-0000000b0349'
      and field = 'body' and language = 'ko'),
  '번역된 공지',
  'the service role reads a cached translation');
reset role;

-- 5-6. The shape is enforced: one row per post, field and language; a hash is a hash.
select throws_ok(
  $$insert into public.content_translations
      (kind, source_id, field, language, source_hash, translated, model)
    values ('notice', '00000000-0000-4000-8000-0000000b0349', 'body', 'ko',
            repeat('c', 64), 'again', 'm')$$,
  '23505', null,
  'one translation per post, field and language (an update replaces it)');
select throws_ok(
  $$insert into public.content_translations
      (kind, source_id, field, language, source_hash, translated, model)
    values ('notice', gen_random_uuid(), 'body', 'pt', 'not-a-hash', 'x', 'm')$$,
  '23514', null,
  'an unknown language or a malformed hash is refused');

select * from finish();
rollback;
