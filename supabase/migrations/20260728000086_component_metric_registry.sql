-- 0086: a registry for component metrics, so the next one is a row and not a
-- migration — plus the first metric that only an admin may see.
--
-- WHAT WAS IN THE WAY. `player_component_power_snapshots.metric` carried a CHECK
-- listing the four board metrics by name (0018). Every new figure the game starts
-- reporting therefore needed a migration to edit that list, and the dashboard
-- needed a code change to label it. Both are friction on the thing this project
-- does constantly: a field appears in a payload, gets understood, and becomes a
-- column.
--
-- So the CHECK becomes a FOREIGN KEY to a registry, and the registry carries what
-- the dashboard needs to draw the metric. Adding one is then:
--
--   1. insert a row here;
--   2. promote the field in the parser.
--
-- No schema change, no front-end change. The chart reads this table.
create table public.component_metrics (
  metric text primary key,
  -- What a reader sees. Not derived from the key: "hero_power_best" is a column
  -- name, "Strongest hero" is a label, and one should not be produced from the
  -- other by replacing underscores.
  label text not null,
  -- Which chart it belongs on and how it behaves there. `family` groups the lines;
  -- `role` decides the axis, because a total is an order of magnitude above its own
  -- best and the two must not share a scale (that is why ComponentTrend splits by
  -- role rather than by family).
  family text not null check (family in ('hero', 'pet', 'account')),
  role text not null check (role in ('total', 'best', 'other')),
  -- WHO MAY SEE IT. The reason this table exists at all rather than a display map
  -- in the client: withholding a figure is a database decision. A metric marked
  -- admin is filtered out of the view below, so a member's query never carries it
  -- and hiding it in React is not what protects it.
  visibility text not null default 'member' check (visibility in ('member', 'admin')),
  sort_order int not null default 100,
  -- What the figure actually means, in one sentence, for whoever meets it next.
  -- The three commands this project rejected were rejected because a field's
  -- meaning turned out to be something else; this is where the verdict lives once
  -- it is settled.
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger component_metrics_set_updated_at
  before update on public.component_metrics
  for each row execute function public.set_updated_at();

alter table public.component_metrics enable row level security;

-- Readable by members, because the labels are what the chart draws. The
-- VISIBILITY of a metric is enforced on the data in the view below, not by hiding
-- its label — a member seeing that "Migration power" exists is not the same as
-- seeing anybody's migration power, and pretending the metric does not exist would
-- make the empty chart unexplainable.
create policy member_read on public.component_metrics
  for select to authenticated
  using (
    public.current_app_role() in ('member', 'officer', 'admin')
    or public.is_service_request()
  );

-- Only settings.write may edit the registry: a label is copy on a shared screen,
-- and `visibility` decides who sees a figure.
create policy settings_write on public.component_metrics
  for all to authenticated
  using (public.has_permission('settings.write'))
  with check (public.has_permission('settings.write'));

grant select on public.component_metrics to authenticated;
grant all on public.component_metrics to service_role;

insert into public.component_metrics (metric, label, family, role, visibility, sort_order, notes)
values
  ('hero_power_total', 'Hero power', 'hero', 'total', 'member', 10,
   'Every hero added up. Board type 45, and equal to the profile''s heroPower.'),
  ('pet_power_total', 'Pet power', 'pet', 'total', 'member', 20,
   'Every pet added up. Board type 79.'),
  ('hero_power_best', 'Strongest hero', 'hero', 'best', 'member', 30,
   'Their single strongest hero, with unit_id naming it. Board type 49, and also '
   'carried by get.user.info.multi as maxPower/maxHeroId — verified equal on 14 of '
   '14 players present in both, which is why both sources write this one metric.'),
  ('pet_power_best', 'Strongest pet', 'pet', 'best', 'member', 40,
   'Their single strongest pet, with unit_id naming it. Board type 80. Not in the '
   'profile payload, so this one is board-only.'),
  -- The admin-only one, and the reason `visibility` exists.
  ('migrate_power', 'Migration power', 'account', 'other', 'admin', 50,
   'What the game counts for a server migration. From get.user.info.multi''s '
   'migratePower. Admin-only: it is the figure behind a decision about whether '
   'somebody can move, and it is nobody else''s business.');

comment on table public.component_metrics is
  'What each component metric means, how to draw it, and who may see it. A new '
  'metric is a row here plus a parser promotion — the snapshot table''s metric '
  'column is a foreign key to this, so there is no CHECK to edit and no front-end '
  'list to extend.';

-- The CHECK becomes a FOREIGN KEY. Same guarantee — an unrecognised metric is
-- still refused — but the set of valid names is now data.
alter table public.player_component_power_snapshots
  drop constraint player_component_power_snapshots_metric_check;

alter table public.player_component_power_snapshots
  add constraint player_component_power_snapshots_metric_fkey
  foreign key (metric) references public.component_metrics (metric);

-- A profile reading has no board. `board_type` was NOT NULL because every source
-- was a board; now that get.user.info.multi writes here too, null means "not from
-- a board" rather than "we forgot".
alter table public.player_component_power_snapshots
  alter column board_type drop not null;

comment on column public.player_component_power_snapshots.board_type is
  'The raw board `type` id, or NULL when the reading did not come from a board — '
  'a profile open carries the same figures with no ranking behind them.';

-- The history view, now registry-driven and gated.
--
-- ADMIN-ONLY METRICS ARE FILTERED HERE. `security_invoker` means the reader''s own
-- role decides, and the disjunct for a service request is 0077''s lesson: a role
-- check in a view''s WHERE clause stops the collector dead, and it took a day to
-- find the first time.
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- reorder or rename columns, and the registry's label belongs beside the metric it
-- labels rather than appended at the end. Nothing but the dashboard reads this
-- view, by name, and 0085 created it one migration ago.
drop view public.player_component_power_history;

create view public.player_component_power_history
with (security_invoker = true) as
select
  s.player_id,
  s.server_id,
  s.captured_at,
  s.metric,
  m.label as metric_label,
  m.family,
  m.role,
  m.sort_order,
  s.power,
  s.rank,
  s.unit_id,
  s.source_command,
  case
    when s.metric like 'hero%' then h.name
    when s.metric like 'pet%' then p.name
  end as unit_name,
  case when s.metric like 'hero%' then h.grade end as unit_grade,
  -- Null for a profile reading, which has no board and therefore no denominator.
  case when s.board_type is not null then count(*) over (partition by s.observation_id) end
    as board_size
from public.player_component_power_snapshots s
join public.component_metrics m on m.metric = s.metric
left join public.heroes h on s.metric like 'hero%' and h.hero_id = s.unit_id
left join public.pets p on s.metric like 'pet%' and p.pet_id = s.unit_id
where m.visibility = 'member'
   or public.current_app_role() = 'admin'
   or public.is_service_request();

-- THE GRANT 0085 FORGOT.
--
-- Every history view in 0073 carries one, and 0085 carried none — so the charts
-- shipped with it answered "permission denied for view
-- player_component_power_history" for every member, and only looked right to
-- whoever checked with the service key, which bypasses grants entirely. RLS was
-- never the problem; there was no GRANT for a policy to be consulted about.
--
-- Not anon: 0065 closed everything to non-members and this is no exception.
grant select on public.player_component_power_history to authenticated;

comment on view public.player_component_power_history is
  'Component readings with their label, family and board size, and with '
  'admin-only metrics withheld from everybody else. A member''s query does not '
  'carry migration power at all — it is not hidden in the client.';
