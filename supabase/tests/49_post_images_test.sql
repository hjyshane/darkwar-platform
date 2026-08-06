-- 0082: the one public bucket, and who may put things in it.
--
-- This bucket is a deliberate hole in a schema that is otherwise closed to
-- non-members, so the things worth pinning are the ones that would quietly widen
-- it: the mime allowlist (an SVG is script hosted on our own origin), the size
-- limit, and the fact that writing needs `guide.write` and stays inside the
-- uploader's own folder.
--
-- What is NOT tested here is anonymous reading, because that does not go through
-- RLS at all — a public bucket is served by the storage API's public endpoint. The
-- `public` flag being true IS the reading rule, so this asserts the flag.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ------------------------------------------------------------------ the bucket
select is(
  (select public from storage.buckets where id = 'post-images'),
  true,
  'the bucket is public — Discord fetches image URLs with no session to present');

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

-- Members may LIST, because the images sit on pages they can already read.
select isnt_empty(
  $$ select name from storage.objects where bucket_id = 'post-images' $$,
  'a member can see what is there');

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
