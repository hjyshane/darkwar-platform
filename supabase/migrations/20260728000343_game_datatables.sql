-- 0343: game_datatables - every datatable of the game client, whole, for an
-- admin to read in the dashboard.
--
-- The other game_* tables (0209 items and costs, 0254 dispatch missions,
-- 0208 event names) each hold ONE thing read out of the client's files and
-- shaped for a screen. Choosing what to promote means reading the raw table
-- first, and until now that meant a Python session on the machine that has
-- the bundles. These four tables carry the raw tables instead, so the
-- reading happens in Settings > Shared > Game data tables, in English or
-- Korean, with a number followable into the table it names.
--
-- Written by `dw-collector game-dump` (gamedata/dump.py) with the service
-- key, in full, after each client update; nothing in the dashboard writes
-- here. Read by admins only: these are the client's files, data-mined with
-- the owner's leave (2026-10-02), not a thing to show members.
--
--   game_datatables        one row per table: its columns, which of them are
--                          localisation keys rather than numbers, and how
--                          many 1,000-row pieces the rows come in
--   game_datatable_rows    the rows, as {id: {column: value}} jsonb, in
--                          1,000-row pieces so a 14 MB table arrives in
--                          parallel rather than as one wait
--   game_datatable_strings the localisation text a table's rows use, per
--                          language - not the whole 35k-line dictionary
--   game_datatable_names   one row per named entity, for "which table is
--                          Orange Skill Book in?" typed into one box
--
-- WHAT IS DERIVED: `loc_columns`. A column is called localised when at least
-- 80% of its non-empty values are keys the English dictionary knows; `id` and
-- `*_id` columns never are. The dashboard shows the string and keeps the key
-- under it, so a wrong call is visible rather than silent.
--
-- NOT DONE: no history. A dump replaces the last one; diffing two client
-- versions is for when somebody asks for it, and would be a fifth table.

create table public.game_datatables (
  name text primary key check (name ~ '^[a-z0-9_]+$'),
  client_version text not null,
  columns jsonb not null check (jsonb_typeof(columns) = 'array'),
  loc_columns jsonb not null default '[]'::jsonb check (jsonb_typeof(loc_columns) = 'array'),
  row_count int not null check (row_count >= 0),
  chunk_count int not null check (chunk_count >= 0),
  byte_size int not null check (byte_size >= 0),
  dumped_at timestamptz not null default now()
);

comment on table public.game_datatables is
  'A datatable of the game client, as dw-collector game-dump last read it '
  '(0343): its columns, which ones hold localisation keys, and how many '
  '1,000-row pieces game_datatable_rows holds for it. Admins only.';

create table public.game_datatable_rows (
  table_name text not null references public.game_datatables (name) on delete cascade,
  chunk int not null check (chunk >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'object'),
  primary key (table_name, chunk)
);

comment on table public.game_datatable_rows is
  'The rows of one client datatable (0343), {row id: {column: value}}, in '
  'pieces of at most 1,000 rows in id order.';

create table public.game_datatable_strings (
  table_name text not null references public.game_datatables (name) on delete cascade,
  lang text not null check (lang in ('en', 'ko')),
  strings jsonb not null check (jsonb_typeof(strings) = 'object'),
  primary key (table_name, lang)
);

comment on table public.game_datatable_strings is
  'The localisation text one client datatable''s localised columns refer to '
  '(0343), {key: text}, per language.';

create table public.game_datatable_names (
  table_name text not null references public.game_datatables (name) on delete cascade,
  row_id text not null,
  name_en text,
  name_ko text,
  primary key (table_name, row_id)
);

comment on table public.game_datatable_names is
  'One row per named entity of a client datatable (0343): what its name '
  'column says in English and Korean, for finding which table a name lives in.';

-- Admins read; the service key writes. Grants here are explicit because
-- 0006's blanket service_role grant was a point in time, and because the
-- hosted default hands `authenticated` everything on a new table.
alter table public.game_datatables enable row level security;
alter table public.game_datatable_rows enable row level security;
alter table public.game_datatable_strings enable row level security;
alter table public.game_datatable_names enable row level security;

revoke all on public.game_datatables from anon, authenticated;
revoke all on public.game_datatable_rows from anon, authenticated;
revoke all on public.game_datatable_strings from anon, authenticated;
revoke all on public.game_datatable_names from anon, authenticated;

grant select on public.game_datatables to authenticated;
grant select on public.game_datatable_rows to authenticated;
grant select on public.game_datatable_strings to authenticated;
grant select on public.game_datatable_names to authenticated;

grant all on public.game_datatables to service_role;
grant all on public.game_datatable_rows to service_role;
grant all on public.game_datatable_strings to service_role;
grant all on public.game_datatable_names to service_role;

-- `(select ...)` so the role is read once per statement, not once per row
-- (0179): a strings document is one row, but a names search is thousands.
create policy admin_read on public.game_datatables
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy admin_read on public.game_datatable_rows
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy admin_read on public.game_datatable_strings
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');
create policy admin_read on public.game_datatable_names
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');
