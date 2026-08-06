-- 0083: the picture bucket stops being public.
--
-- 0082 made `post-images` public and said why: Discord fetches image URLs with no
-- session, so a member-only bucket shows the channel a broken thumbnail. That
-- reasoning was sound and the conclusion was avoidable — the collector can carry
-- the FILE to Discord instead of a link to it.
--
-- So the bucket closes, and the two readers are served differently:
--
--   * the dashboard signs a short-lived URL per render. An `<img>` cannot send an
--     Authorization header, so a signed URL is the only way a browser fetches a
--     private object;
--   * the collector downloads the object with the service key and ATTACHES it to
--     the webhook. Discord then hosts its own copy and shows it in the channel,
--     with nothing on our side left readable by URL.
--
-- What this buys, and it is the whole point: "anybody with the link" is gone.
-- 0082's uuid names were obscurity, not access control, and a roster screenshot
-- uploaded by mistake was published to the internet. Now it is published to the
-- alliance, which is who the dashboard is for.
--
-- What it costs: a signed URL expires (an hour by default), so a page left open
-- long enough shows a broken image until it is reloaded. That is a worse failure
-- than a stale number and a better one than a public bucket.
update storage.buckets
   set public = false
 where id = 'post-images';

-- WHERE THE PICTURE IS REMEMBERED BETWEEN ENQUEUE AND DELIVERY.
--
-- The outbox row carried title and body and nothing else, and `guide_message`
-- strips image lines OUT of the body — so the URL was known when the row was
-- written and gone by the time anything posted it. A column rather than parsing it
-- back out of the body at delivery: the body is already the stripped text, and
-- reconstructing what was removed from it is guessing at a fact we had.
--
-- Nullable, because most notifications have no picture — a rank report never will.
alter table public.notification_outbox
  add column if not exists image_url text;

comment on column public.notification_outbox.image_url is
  'The one picture to attach, named as a post-images object URL. The worker '
  'downloads it with the service key and uploads the FILE to Discord (0083): the '
  'bucket is private, so a URL in the embed would be unfetchable and a signed one '
  'would expire in the channel.';

-- The select policy from 0082 now does real work. While the bucket was public,
-- reading went through the public endpoint and never consulted RLS; from here
-- every read is either a signed URL or an authenticated request, and this is what
-- decides the latter. Recreated rather than trusted to still be there, because
-- the policy being absent and the policy being permissive look identical from
-- outside until somebody checks.
drop policy if exists post_images_read on storage.objects;
create policy post_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-images'
    and public.current_app_role() in ('member', 'officer', 'admin')
  );
