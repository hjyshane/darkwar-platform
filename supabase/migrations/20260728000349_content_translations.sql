-- 0349: content_translations - notices, guides and comments translated on a
-- reader's request, kept so the next reader does not pay for it again.
--
-- WHY. The site speaks nine languages since 2026-11-24, but only the words in
-- its code: what admins and members WRITE (a notice, a guide, a comment) stays
-- in whatever language its author used. The owner chose a button over
-- translating everything on save (2026-11-24): a reader who needs it presses
-- "Translate", and nobody pays for languages nobody reads.
--
-- HOW. The Edge Function `translate` reads the post AS THE READER (their JWT),
-- so RLS still decides who may see what; only then, with the service role, does
-- it look here for a cached translation and write a new one. This table is
-- therefore closed to anon and authenticated: a translation of a member-only
-- notice must not be readable by somebody who cannot read the notice.
--
-- A translation is tied to the exact text it came from (`source_hash`, sha-256
-- of the original): edit the notice and the old translation simply stops
-- matching, with nothing to invalidate.
--
-- The daily limit per reader (Settings › Shared › Site values, key
-- site.translation_daily_limit; 0 turns translation off) counts the rows a
-- reader caused to be written in the last 24 hours. Cached answers are free.
--
-- NOT HERE: translating on save, the game's own text (it comes in the reader's
-- language from the game data where there is one), and retention — a row is a
-- few kilobytes and is replaced when its source changes.

create table public.content_translations (
  kind text not null check (kind in ('notice', 'guide', 'comment')),
  source_id uuid not null,
  field text not null check (field in ('title', 'body')),
  language text not null check (language in ('en', 'ko', 'fr', 'tr', 'it', 'es', 'de', 'zh', 'vi')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  translated text not null,
  model text not null,
  -- No foreign key: a reader's account can go, and their count with it.
  requested_by uuid,
  created_at timestamptz not null default now(),
  primary key (kind, source_id, field, language)
);

comment on table public.content_translations is
  'Translations of notices, guides and comments made on a reader''s request '
  '(0349). Written and read only by the translate Edge Function with the '
  'service role, after it has read the source as the reader.';

-- The daily-limit count: one reader's writes in the last day.
create index content_translations_requested_idx
  on public.content_translations (requested_by, created_at desc);

alter table public.content_translations enable row level security;
revoke all on public.content_translations from public, anon, authenticated;
grant all on public.content_translations to service_role;
-- No policy for anon or authenticated: with RLS on and no grant, both are
-- refused outright. The service role bypasses RLS.
