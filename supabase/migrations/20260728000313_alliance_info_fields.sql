-- 0313: the alliance's own words and join rules, promoted out of raw.
--
-- `get.al.info` has carried intro, announce, language, joinApproval,
-- powerRestrictionN, castleRestrictionN, maxMember and country in every
-- capture since the parser landed (fixture love_580_v1), and the alliance page
-- shows none of them. Per the schema rule a key observed consistently moves to
-- a typed column; the normalizer (get_al_info 1.1.0) now writes these eight
-- and this file fills them for every row already here, so history is kept.
--
-- WHO READS WHAT. Intro, join rule, minimums, language and the member cap are
-- for every signed-in role that can read alliance_snapshots today. The
-- announcement is for members of THAT alliance and admins, decided per row:
-- the viewer has an alliance_memberships row for auth.uid() and the
-- snapshot's alliance_id. Not current_app_role(): that is per request, from
-- the x-alliance-id header, and since 0192/0193 an account can belong to two
-- own alliances — a role gate would hand alliance A's member alliance B's
-- announcement whenever the header said A. Mirrors the game, which shows an
-- outsider the intro and not the announcement.
--
-- KNOWN AND LEFT ALONE: `raw` already carries `announce` and is readable by
-- the same roles that read the table. The typed column plus this view are
-- what the page reads; closing `raw` column-wide is a separate decision
-- touching every snapshot table and is not made here.

alter table public.alliance_snapshots
  add column intro text,
  add column announce text,
  add column language text,
  add column join_approval int,
  add column min_power bigint,
  add column min_hq int,
  add column max_members int,
  add column country text;

comment on column public.alliance_snapshots.intro is
  'get.al.info `intro`: the alliance''s public description, as written. Empty becomes null.';
comment on column public.alliance_snapshots.announce is
  'get.al.info `announce`: the members-only announcement. Read it through '
  'alliance_info_latest, which nulls it unless the viewer belongs to the alliance.';
comment on column public.alliance_snapshots.language is
  'get.al.info `language`: a client localization key, not a name (391083 = Traditional '
  'Chinese). Resolved in features/alliance/codes.ts; an unknown key displays as itself.';
comment on column public.alliance_snapshots.join_approval is
  'get.al.info `joinApproval`, the raw integer. Its meaning is UNCONFIRMED: fixture ADET '
  'has joinApproval 1 with recruitTotal 1, and the legacy code printed it raw. Check the '
  'alliance in the client to learn whether 1 is "needs approval" or "open join" and record '
  'the answer here before any sentence is written from it (spec 2026-11-08-alliance-page).';
comment on column public.alliance_snapshots.min_power is
  'get.al.info `powerRestrictionN`: minimum power to join.';
comment on column public.alliance_snapshots.min_hq is
  'get.al.info `castleRestrictionN`: minimum HQ level to join.';
comment on column public.alliance_snapshots.max_members is
  'get.al.info `maxMember` (alliance.rank carries it too): the member cap.';
comment on column public.alliance_snapshots.country is
  'get.al.info `country`: ISO 3166-1 alpha-2 as the client sends it.';

-- Backfill from raw. Numbers are read through ->> and a digit guard so a
-- value of the wrong JSON type (a quoted "1", a null) lands as null instead of
-- aborting the migration. Empty strings are no text.
update public.alliance_snapshots set
  intro         = nullif(raw ->> 'intro', ''),
  announce      = nullif(raw ->> 'announce', ''),
  language      = nullif(raw ->> 'language', ''),
  join_approval = case when raw ->> 'joinApproval' ~ '^-?\d{1,9}$'
                       then (raw ->> 'joinApproval')::int end,
  min_power     = case when raw ->> 'powerRestrictionN' ~ '^-?\d{1,18}$'
                       then (raw ->> 'powerRestrictionN')::bigint end,
  min_hq        = case when raw ->> 'castleRestrictionN' ~ '^-?\d{1,9}$'
                       then (raw ->> 'castleRestrictionN')::int end,
  max_members   = case when raw ->> 'maxMember' ~ '^-?\d{1,9}$'
                       then (raw ->> 'maxMember')::int end,
  country       = nullif(raw ->> 'country', '')
where raw ?| array['intro', 'announce', 'language', 'joinApproval',
                   'powerRestrictionN', 'castleRestrictionN', 'maxMember', 'country'];

-- Does the caller belong to this alliance? Admin is global; everybody else
-- needs a membership row for exactly this alliance_id. security invoker is
-- enough: 0192's own_or_manager_read lets an account read its own rows, and
-- that is the only row this asks about. 0314's alliance_moves uses it too.
create function public.belongs_to_alliance(p_alliance uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.current_app_role()) = 'admin'
      or exists (select 1
                   from public.alliance_memberships m
                  where m.user_id = (select auth.uid())
                    and m.alliance_id = p_alliance);
$$;

revoke all on function public.belongs_to_alliance(uuid) from public, anon;
grant execute on function public.belongs_to_alliance(uuid) to authenticated, service_role;

comment on function public.belongs_to_alliance(uuid) is
  'True for an admin, or for a caller with an alliance_memberships row for this '
  'alliance. Per alliance, not per request: the x-alliance-id header plays no part.';

-- The newest info card per alliance. Only get.al.info rows: a ranking
-- snapshot taken an hour later carries none of these fields and would
-- otherwise win the distinct on and blank the card. distinct on alliance_id,
-- not external_id (0035 predates alliances being unique per server, 0192):
-- an alliance that relocated is two rows and keeps two cards.
create view public.alliance_info_latest
with (security_invoker = true) as
select distinct on (s.alliance_id)
  s.snapshot_id,
  s.alliance_id,
  s.server_id,
  s.external_id,
  s.name,
  s.code,
  s.power,
  s.member_count,
  s.leader_game_uid,
  s.intro,
  case when public.belongs_to_alliance(s.alliance_id) then s.announce end as announce,
  s.language,
  s.join_approval,
  s.min_power,
  s.min_hq,
  s.max_members,
  s.country,
  s.captured_at
from public.alliance_snapshots s
where s.source_command = 'get.al.info'
order by s.alliance_id, s.captured_at desc;

revoke all on public.alliance_info_latest from anon;
grant select on public.alliance_info_latest to authenticated, service_role;

comment on view public.alliance_info_latest is
  'The newest get.al.info card per alliance: intro, join rule (raw), minimums, language, '
  'member cap, country. announce is null unless the viewer belongs to that alliance '
  '(belongs_to_alliance), decided per row. security_invoker, so the table''s RLS applies.';
