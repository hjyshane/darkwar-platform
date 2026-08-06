-- 0082: somewhere to put a picture in a guide.
--
-- THIS BUCKET IS PUBLIC, AND THAT IS A DELIBERATE EXCEPTION TO EVERYTHING ELSE
-- IN THIS SCHEMA.
--
-- 0065 closed every table to non-members. This does not close, and cannot: the
-- point of an image on a guide is that Discord shows it in the channel, and
-- Discord fetches image URLs anonymously with no session to present. A
-- member-only bucket means the channel gets a broken thumbnail. The trade was
-- put to the owner and taken deliberately.
--
-- So: ANYONE WITH THE URL CAN SEE THESE FILES. The object names are uuids, which
-- makes them unguessable, and unguessable is not access control — it is
-- obscurity, and it should be read as "not secret" rather than "hard to find".
--
-- What follows from that, and is written on the bucket so it is in front of
-- whoever looks next:
--
--   * this bucket is for illustrations that accompany advice — a hero line-up, a
--     map corner, a screenshot of a game menu;
--   * it is NOT for anything the dashboard withholds. A roster screenshot carries
--     94 people's power on it, and putting one here publishes what 0063 through
--     0065 exist to keep inside the alliance.
--
-- Uploading is gated on `guide.write`, so it is officers and admins — the people
-- who write the guides — rather than every member. Reading is the internet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  -- 5 MB. A phone screenshot is under one; anything above five is a mistake
  -- rather than a picture, and the limit is enforced by storage rather than by
  -- the upload form, which a determined client can skip.
  5242880,
  -- An allowlist, and no SVG. An SVG is a document that can carry script, and
  -- browsers execute it when the file is opened directly — which for a public
  -- bucket means anybody can be handed a link to script hosted on our own
  -- origin. The other four cannot do that.
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are named `<uploader uuid>/<random uuid>.<ext>`.
--
-- The folder is the uploader, which does two things: it makes "who put this
-- here" answerable from the object name alone after the guide that used it has
-- been edited or deleted, and it gives the policies below something to compare
-- against without a second table.

-- WRITING. Gated on the capability rather than the role, so the officer/admin
-- split stays in `role_permissions` where the rest of it lives (0045), and
-- restricted to the uploader's own folder — otherwise one officer could write
-- into another's and the name would lie about who did it.
create policy post_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and public.has_permission('guide.write')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- READING, for the API. The public endpoint (`/object/public/...`) does not
-- consult this — a public bucket serves anonymously, which is the entire reason
-- this bucket is public — so this policy is only about a signed-in client
-- LISTING objects. Members may, because the images are on pages they can read
-- anyway.
create policy post_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-images'
    and public.current_app_role() in ('member', 'officer', 'admin')
  );

-- REMOVING. Your own, or an admin's — an admin has to be able to take down an
-- image somebody else uploaded, and that is the whole reason this is not simply
-- "your own folder".
create policy post_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-images'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.current_app_role() = 'admin'
    )
  );

-- No `comment on table storage.objects`: the migration role does not own it
-- ("must be owner of table objects", 42501), and storage is Supabase's schema
-- rather than ours to annotate. The warning above is the record, and
-- `docs/runbooks/going-public.md` carries it where an operator will meet it.
