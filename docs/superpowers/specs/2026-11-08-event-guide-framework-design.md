# Event guide framework — design

Date: 2026-11-08. Status: draft for builder check.
Depends on: `2026-11-08-console-foundation-design.md` for phase B
(`Chip`, `StepTable`, `CellGrid`, `Led`).

## Intent

The event guide (`features/eventGuide/`) covers two events, Survival
Preparedness and Alliance Duel, with content assembled from the client's
`score` table and the server's theme calendar. The importer is hard-filtered
to those two activity ids. Every other event (seasonal festivals, the
Halloween set in the screenshots, future ones of the same shape) has no
home. The competitor publishes, per event: rewards, stages with per-stage
drops, daily point tables with "best day for this item", a "prepare now"
checklist with caps, and ammo or currency sources with limits.

We build the framework those guides share, so a new event is data entry
plus whatever the client tables already give, not a new page. And we add
the one thing a public site cannot: the checklist evaluated against the
viewer's own stock.

## Goals

- One guide model that holds every section type seen so far: rewards,
  stages, point tables by day, "best day" derivation, prepare-now
  checklist, currency sources with caps, notes.
- Score tables imported for every activity the server's
  `hero.event.info.get` packet has described in the journal, not a
  hardcoded two. Events whose scoring never arrives in that packet
  (seasonal festivals, so far) are officer-typed into the same model.
- Officers author the parts the client does not supply, in the dashboard,
  with item icons resolved from `game_icon_refs`.
- A viewer with a linked account sees "you hold N → M points on day X".
- The two existing guides keep working and move onto the framework where
  that is a matter of rendering, not re-import.

## Non-goals

- Decoding event rules from Lua UI scripts. If a number is not in a data
  table, an officer types it.
- Event participation tracking, leaderboards or per-member event scores
  (the existing Duel scores tab stays as it is).
- Countdown and schedule logic beyond what `game_event_calendar` and
  `schedule_events` already give.

## Anti-goals

- A per-event React page. Adding an event must not add a component.
- Icons leaving the members-only path. `game_icons` stays members-only
  (0232); sections render an icon only when the viewer can read it.
- Guessing an item's best day from incomplete tables. "Best day" is shown
  only when the item appears in at least two days' tables.

## Model

New tables (one migration; numbers from `origin/main` at push):

- `event_guides`: `guide_id`, `activity_id` (nullable; festivals may not
  map one-to-one), `slug` unique, `title`, `title_ko`, `summary`,
  `summary_ko`, `starts_rule jsonb` (how start is decided: by server range
  and weekday, free-form but structured), `published boolean`,
  `updated_by`, `updated_at`.
- `event_guide_sections`: `section_id`, `guide_id`, `kind` in
  (`rewards`, `stages`, `point_table`, `prep`, `sources`, `notes`),
  `title`, `title_ko`, `sort_order`, `source` in (`client`, `officer`),
  `payload jsonb`, `updated_by`, `updated_at`.

Payload shapes are owned by TypeScript schemas in
`features/eventGuide/sections/*.ts` (zod or the repo's existing validator;
builder checks what the board or admin features use). One schema per
kind, with a fixture per kind taken from the Halloween screenshots:

- `rewards`: list of `{item_ref, label, kind (skin|title|emoji|frame|...),
  how (free text), icon_ref?}`.
- `stages`: `{groups: [{label, stages: [{n, drops: [{item_ref, qty}]}]}],
  totals: [{item_ref, qty}]}`.
- `point_table`: `{day, theme, rows: [{action, points, item_ref?, per?,
  best_day_hint?}]}`. One section per day; the importer writes these from
  `game_event_scores` for client-sourced activities.
- `prep`: `{items: [{item_ref | resource, unit, per_unit_points?,
  per_unit_shots?, cap?, day?}]}`.
- `sources`: `{rows: [{source, rate, cap}], total_cap, note}`.
- `notes`: `{text, text_ko}`.

`item_ref` is `{kind: 'item'|'resource'|'hero'|..., id}` resolved through
`game_items`, `game_resources` and `game_icon_refs` at render time, so a
renamed item renames everywhere.

Client-sourced `point_table` rows describe *actions* ("consume 1 orange
hero shard"), and the client `score` table carries no item id. So a third
table carries the mapping, owned by officers and never touched by the
importer:

- `game_event_score_items`: `score_id` (the client's id, global across
  events and years) primary key, `item_ref jsonb`, `per numeric` (units of
  the item per scored action, default 1), `updated_by`, `updated_at`.

At render time a `point_table` row with no `item_ref` of its own takes the
map's entry for its `score_id`. The admin editor shows client rows with an
"item" column that writes to this map, so an officer types the mapping
once and every later event that reuses the same `score_id` inherits it.
`bestDays` and the prep check consume the merged rows, so they work on
imported data once the map is filled.

Scope: event guides are shared game facts, like the catalogue and
`event_names`. No `alliance_id`. Readers are every signed-in role that
reads `game_event_scores` today. Writers are admins and holders of the
existing `guide.write` / `guide.edit` / `guide.delete` capabilities (0078)
in their current alliance; no new capability, so nothing to seed through
the 0200 fan-out. The pgTAP negative test is: community cannot write; a
member without `guide.write` cannot write.

Relationship to the 0078 `guides` board: separate. That board is
free-form posts; this is typed sections. An `event_guides.post_id`
(nullable FK to `guides`) lets a guide link to a long-form post for the
"how to play it" prose, instead of growing a prose kind here.

Start times: when `activity_id` is set, the picker sorts on
`event_schedule_current` (0208 already unrolls `init.activity` into
per-server start and end). `starts_rule` is only the fallback for guides
with no `activity_id`, and the editor says so.

Derived, not stored: **best day per item**, computed by
`bestDays(sections)` in `features/eventGuide/bestDays.ts`: for each
`item_ref` appearing in `point_table` rows across days, the day with the
highest points, ties listed. Fixture tests from the screenshot tables
(orange hero shard: 750 on day 2, 500 on days 5–6 → best day 2).

## Importer (collector, Python; commit from the main checkout)

The client `score` table is keyed by `score_id` only (name, value,
points). Which scores belong to which activity, theme and day comes from
the server's `hero.event.info.get` packet, which the collector sees only
for events the account opens. So the importer's reach is "every activity
that packet has described in the journal", no more.

`gamedata/event_guide.py` drops the `ACTIVITIES = {"100004","70005"}`
filter and the hardcoded calendar activity id. It builds themes and scores
for every activity id found in `hero.event.info.get` and
`get.hero.event.calendar` rows in the journal, writes `game_event_themes`
/ `game_event_scores` / `game_event_calendar` as today, and, new, upserts
one `client`-sourced `point_table` section per activity and day into
`event_guide_sections` under an auto-created, unpublished `event_guides`
row keyed by `activity_id`. Officer-sourced sections and
`game_event_score_items` are never overwritten; client-sourced sections
are replaced on each run. `--dry-run` reports activities seen, guides
touched, sections written, and lists activity ids with no name so the
operator can run `game-names` first.

Events whose scoring never arrives in that packet (the seasonal festivals
seen so far) get officer-typed `point_table` sections. If a festival is
later observed in the packet, the importer picks it up with no code
change, and the officer-typed section can be deleted.

## Dashboard

### Authoring (officers and admins)

Under the existing admin surface pattern (`features/admin/*Setting.tsx`):
a guide list, a guide form (title, slug, summary, start rule, published),
and a section editor per kind with a structured form, not raw JSON, for
`rewards`, `stages`, `prep`, `sources`, and a text editor for `notes`.
Item picker searches `game_items` and `game_resources` by name in both
languages and shows the icon when available. Client-sourced sections are
read-only in the editor with a "re-import to refresh" note.

### Reading (phase B, on the kit)

`#/event-guide` gains a guide picker: published guides, upcoming first by
`starts_rule`, then the two legacy tabs until they are migrated. A guide
renders its sections in `sort_order`:

- `rewards` as a `Chip` grid with icon, label, how.
- `stages` as `StepTable` groups with the totals row.
- `point_table` per day as `StepTable` with the "best day" badge on rows
  whose item wins that day.
- `prep` as `CellGrid` cells: for a viewer with an `account_state_latest`
  row (same gate as the planner), each cell shows held quantity, the cap,
  and the derived figure ("412 held → 309,000 pts on day 2"); for anyone
  else the cell shows the rule only. A `Led` marks stock freshness.
- `sources` as a `StepTable` with a total row.
- `notes` as text.

Start times render in the viewer's zone with the server-time rule the page
already uses.

## Migration of the two existing guides

Survival Preparedness and Alliance Duel keep their current tabs. Their
score content is already in `game_event_scores`; the importer now also
writes them as `point_table` sections, so they appear in the picker as
guides too. The old tabs are removed only when the new rendering shows the
same information; that check is part of this project's definition of done,
and if it fails, the tabs stay and the PR says so.

## Access

- `event_guides`, `event_guide_sections`, `game_event_score_items`: select
  for every signed-in role that can read `game_event_scores` today (0283
  widened that to community); insert/update/delete for admins and holders
  of `guide.write` / `guide.edit` / `guide.delete` in their current
  alliance, through `has_permission` as the 0078 board does. pgTAP
  negative tests: community cannot write; a member without `guide.write`
  cannot write.
- Hosted traps: explicit grants to `authenticated` and community, revoke
  from `anon`, revoke execute on new functions from `anon`.
- Icons: unchanged members-only path.

## Constraints

- Migration numbering from `origin/main` at push.
- Collector change committed from the main checkout; `dw-collector
  game-event-guide --dry-run` output pasted into the PR.
- One `captured_at` rule and other fixture traps in CLAUDE.md apply to
  pgTAP fixtures here too.
- Language: English UI, as the site is today (user decision 2026-11-08).
  The `*_ko` columns stay as optional data fields an officer may fill,
  because the client tables carry Korean names and officers write in both
  languages; nothing in the UI switches on them yet.

## Left to the builder

- Whether `starts_rule` is better as two columns (server-range,
  weekday+time) than jsonb; pick whichever the picker's sort needs.
- Section editor field layouts.
- Whether the picker lives as a tab strip or a select.

## Decided by Claude, user can override

- Officer-authored content for everything the client tables do not hold.
  No attempt to decode event UI Lua for rewards or stage drops.
- The personal prep check uses the planner's account gate and stock path,
  not a new one.
- Guides are unpublished by default when auto-created by the importer, so
  a raw score table never appears to members before an officer looks at
  it.
