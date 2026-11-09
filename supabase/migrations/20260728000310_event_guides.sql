-- 0310: the event guide model — one guide per event, built from typed sections.
--
-- The 0248 tables hold what the game says scores in Survival Preparedness and
-- the Alliance Duel. Every other event (the seasonal festivals, future ones of
-- the same shape) had no home, and what a guide needs beyond the score table —
-- rewards, stage drops, a prepare-now checklist with caps, currency sources —
-- is nowhere in the client's data tables. So: a guide row per event and a
-- section row per block of content, with the section's shape owned by the
-- dashboard (features/eventGuide/sections/*.ts) and stored as jsonb here.
--
--   event_guides            one per event; `activity_id` when the game has an id
--                           for it (the importer keys on it), null for a festival
--                           an officer types by hand. Unpublished until an officer
--                           looks at it, so a raw score table never appears to
--                           members on its own.
--   event_guide_sections    the blocks, in `sort_order`. `source` says who wrote
--                           it: 'client' rows are rewritten by dw-collector
--                           game-event-guide on every run; 'officer' rows are
--                           never touched by it.
--   game_event_score_items  which item a client score id consumes, and how many
--                           per scored action. The client's `score` table names
--                           an action ("consume 1 orange hero shard") but no item
--                           id, so an officer maps it once; the id is global
--                           across events and years, so every later event that
--                           reuses it inherits the mapping. Officer-owned, never
--                           written by the importer.
--
-- Separate from the 0078 `guides` board on purpose: that is free-form prose,
-- this is typed. `post_id` lets a guide point at a post for the "how to play
-- it" writing instead of growing a prose kind here.
--
-- Access: shared game facts, like the catalogue. Readers are every signed-in
-- role that reads game_event_scores (0283 made that community too). Writers
-- hold the 0078 guide.* capabilities in their current alliance through
-- has_permission, so there is no new capability and nothing to fan out (0200).

create table public.event_guides (
  guide_id uuid primary key default gen_random_uuid(),
  activity_id text unique check (activity_id is null or activity_id ~ '^[0-9]+$'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  title_ko text,
  summary text,
  summary_ko text,
  -- How the start is decided when there is no activity_id to look up in
  -- event_schedule_current (0208): free-form but structured, read by the picker.
  starts_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(starts_rule) = 'object'),
  published boolean not null default false,
  post_id uuid references public.guides (guide_id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.event_guide_sections (
  section_id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.event_guides (guide_id) on delete cascade,
  kind text not null
    check (kind in ('rewards', 'stages', 'point_table', 'prep', 'sources', 'notes')),
  title text,
  title_ko text,
  sort_order int not null default 0,
  source text not null default 'officer' check (source in ('client', 'officer')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create index event_guide_sections_guide_order_idx
  on public.event_guide_sections (guide_id, sort_order);

create table public.game_event_score_items (
  score_id text primary key check (score_id ~ '^[0-9]+$'),
  -- {"kind": "item" | "resource" | "hero" | ..., "id": "253042"}, resolved
  -- through game_items / game_resources / game_icon_refs at render time.
  item_ref jsonb not null check (jsonb_typeof(item_ref) = 'object'),
  -- Units of the item one scored action consumes.
  per numeric not null default 1 check (per > 0),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.event_guides is
  'One event guide per event: typed sections under it (0310). activity_id when '
  'the game has one (the importer creates these, unpublished); null for a '
  'festival an officer types. Shared game facts, no alliance.';
comment on table public.event_guide_sections is
  'The blocks of an event guide in sort_order (0310). Shape per `kind` is owned '
  'by the dashboard. source=client rows are rewritten by dw-collector '
  'game-event-guide; source=officer rows are never touched by it.';
comment on table public.game_event_score_items is
  'Which item a client score id consumes and how many per scored action (0310). '
  'Officer-owned; the importer never writes it. The id is global across events, '
  'so one mapping serves every event that reuses it.';

-- The editor is whoever is signed in; the importer (service role, no uid)
-- leaves the last editor in place. updated_at always moves.
create function public.event_guide_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.event_guide_stamp() from public, anon;

create trigger event_guides_stamp
  before update on public.event_guides
  for each row execute function public.event_guide_stamp();
create trigger event_guide_sections_stamp
  before update on public.event_guide_sections
  for each row execute function public.event_guide_stamp();
create trigger game_event_score_items_stamp
  before update on public.game_event_score_items
  for each row execute function public.event_guide_stamp();

alter table public.event_guides enable row level security;
alter table public.event_guide_sections enable row level security;
alter table public.game_event_score_items enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207).
revoke all on public.event_guides, public.event_guide_sections, public.game_event_score_items
  from anon, authenticated;
grant select, insert, update, delete
  on public.event_guides, public.event_guide_sections, public.game_event_score_items
  to authenticated;
grant all on public.event_guides, public.event_guide_sections, public.game_event_score_items
  to service_role;

-- Reading: the same four roles that read game_event_scores after 0283.
-- Drafts are read too; the picker shows published ones, and a writer needs to
-- see what they are editing. There is no alliance secret in a game fact.
create policy member_read on public.event_guides
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'community', 'officer', 'admin'));
create policy member_read on public.event_guide_sections
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'community', 'officer', 'admin'));
create policy member_read on public.game_event_score_items
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'community', 'officer', 'admin'));

-- Writing: the 0078 capabilities, verb for verb.
create policy writer_insert on public.event_guides
  for insert to authenticated
  with check ((select public.has_permission('guide.write')));
create policy writer_update on public.event_guides
  for update to authenticated
  using ((select public.has_permission('guide.edit')))
  with check ((select public.has_permission('guide.edit')));
create policy writer_delete on public.event_guides
  for delete to authenticated
  using ((select public.has_permission('guide.delete')));

create policy writer_insert on public.event_guide_sections
  for insert to authenticated
  with check ((select public.has_permission('guide.write')));
create policy writer_update on public.event_guide_sections
  for update to authenticated
  using ((select public.has_permission('guide.edit')))
  with check ((select public.has_permission('guide.edit')));
create policy writer_delete on public.event_guide_sections
  for delete to authenticated
  using ((select public.has_permission('guide.delete')));

create policy writer_insert on public.game_event_score_items
  for insert to authenticated
  with check ((select public.has_permission('guide.write')));
create policy writer_update on public.game_event_score_items
  for update to authenticated
  using ((select public.has_permission('guide.edit')))
  with check ((select public.has_permission('guide.edit')));
create policy writer_delete on public.game_event_score_items
  for delete to authenticated
  using ((select public.has_permission('guide.delete')));
