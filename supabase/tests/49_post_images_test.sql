-- 0082/0083: the picture bucket, and who may put things in it or read them.
--
-- The things worth pinning are the ones that would quietly widen it: the mime
-- allowlist (an SVG is script served from our own origin), the size limit, that
-- writing needs `guide.write` and stays inside the uploader's own folder, and —
-- since 0083 — that the bucket is not public.
--
-- 0082 made it public for one reason: Discord fetches an image URL with no session
-- to present. 0083 removed that reason by having the collector attach the FILE to
-- the webhook instead of a link to it, so the flag going back to false is now the
-- assertion that matters. With it true, every picture the alliance uploads is
-- readable by anybody holding the URL.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- ------------------------------------------------------------------ the bucket
select is(
  (select public from storage.buckets where id = 'post-images'),
  false,
  'the bucket is NOT public — the collector carries the file to Discord instead');

select is(
  (select file_size_limit from storage.buckets where id = 'post-images'),
  5242880::bigint,
  'five megabytes, enforced by storage rather than by the upload form');

-- The allowlist, asserted as a set rather than "contains png". A blocklist or a
-- loose check is how image/svg+xml gets back in.
select set_eq(
  $$ select unnest(allowed_mime_types) from storage.buckets where id = 'post-images' $$,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  'four raster types and nothing else');

-- Said explicitly, because it is the one that matters and the one somebody would
-- add back for convenience. An SVG is a document that can carry script, and a
-- browser runs it when the file is opened directly — on a PUBLIC bucket that is
-- script hosted on our own origin, handed out by link.
select ok(
  not exists (
    select 1 from storage.buckets
     where id = 'post-images'
       and 'image/svg+xml' = any(allowed_mime_types)),
  'and never SVG, which is script that a browser will run from our own origin');

-- ---------------------------------------------------------------- the policies
insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc82', 'image test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000af082', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'img-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000bf082', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'img-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000cf082', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'img-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000af082', 'officer'),
  ('00000000-0000-4000-8000-0000000bf082', 'member'),
  ('00000000-0000-4000-8000-0000000cf082', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- AN OFFICER, who writes the guides and therefore uploads the pictures.
select pg_temp.act_as('00000000-0000-4000-8000-0000000af082');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('post-images',
             '00000000-0000-4000-8000-0000000af082/aaaa1111.png',
             (select auth.uid())) $$,
  'an officer can upload into their own folder');

-- The folder is the uploader, so "who put this here" survives the guide being
-- edited or deleted. Writing into somebody else's makes the name lie.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('post-images',
             '00000000-0000-4000-8000-0000000bf082/bbbb2222.png',
             (select auth.uid())) $$,
  '42501',
  NULL,
  'but not into another account''s folder');

-- A MEMBER, who has no `guide.write`. Not a courtesy — a public bucket that every
-- member can write to is an open image host with our project ref on it.
select pg_temp.act_as('00000000-0000-4000-8000-0000000bf082');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('post-images',
             '00000000-0000-4000-8000-0000000bf082/cccc3333.png',
             (select auth.uid())) $$,
  '42501',
  NULL,
  'a member without guide.write cannot upload at all');

-- Members may READ, and since 0083 this policy is what decides it — while the
-- bucket was public, reads went through the public endpoint and never reached RLS.
select isnt_empty(
  $$ select name from storage.objects where bucket_id = 'post-images' $$,
  'a member can read what is there');

-- The other half, and the whole point of 0083: somebody who is not a member gets
-- nothing. `anon` is what an unauthenticated storage request arrives as, and this
-- is the row filter behind the signed URL the dashboard hands out.
reset role;
set local role anon;
select is_empty(
  $$ select name from storage.objects where bucket_id = 'post-images' $$,
  'and nobody signed out can — "anybody with the URL" is what 0083 removed');
reset role;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000bf082');

-- REMOVAL IS ASSERTED AS A POLICY, NOT AS BEHAVIOUR, and the reason is worth
-- writing down: storage carries its own trigger, `storage.protect_delete()`,
-- which refuses EVERY direct SQL delete from `storage.objects` regardless of RLS
-- ("Direct deletion from storage tables is not allowed. Use the Storage API
-- instead."). So a delete cannot be exercised from here by anybody, and asserting
-- survival would pass for the wrong reason — the trigger, not the policy.
--
-- What is checkable in SQL is that the policy exists and says what it should. The
-- behaviour is exercised through the Storage API by hand; the runbook records it.
select isnt_empty(
  $$ select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'post_images_delete' and cmd = 'DELETE' $$,
  'there is a delete policy for the bucket');

-- Both halves of it. Own-folder alone would leave an image nobody but its
-- uploader could take down, and admin alone would stop an officer tidying up
-- after themselves.
select ok(
  (select qual like '%foldername%' and qual like '%current_app_role%'
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'post_images_delete'),
  'and it allows the uploader''s own folder OR an admin, not one or the other');

reset role;
select * from finish();
rollback;
