# Calculator reference mode — design

Date: 2026-11-08. Status: draft for builder check.
Depends on: `2026-11-08-console-foundation-design.md` for phase B
(`CellGrid`, `StepTable`, `Chip`).

## Intent

The planner (`features/planner/`) is account-bound and goal-oriented: pick
an account, pick targets, see what it takes against your stock. That is
its strength and stays. What it cannot do is answer the quick question
"what does HQ 28→30 cost" without an account, a target list and a settings
pass, and it cannot be linked to. The competitor's calculators are exactly
that: subject, from, to, two buff fields, a totals row, a step table, a
copy-link button. We add that as a **reference mode** on top of the
planner's existing data layer, and close two data gaps (vehicle chips,
season buildings) so the reference covers what players actually ask about.

## Goals

- Any signed-in account, community included, can open a subject, set from
  and to, set speed and cost buffs, and read totals plus a step table, with
  the state in the URL so the link can be pasted in alliance chat.
- "Load into my plan" pushes the same selection into the planner for
  viewers who have an account there.
- Vehicle chips (star-up EXP and duplicates per rank) and season buildings
  (per season) become upgrade subjects if the client tables carry them.
- No duplicated cost logic. Reference mode calls the planner's
  `plan.ts`/`levels.ts`/`format.ts`.

## Non-goals

- Anonymous access. Every route except login, month cards, terms and
  privacy is walled to signed-in roles, and `game_upgrade_*` tables revoke
  `anon`. Reference mode sits behind the same wall.
- Replacing the planner's "What to raise" or "Next upgrades" flows.
- Hero gear level-up materials. The runbook records that the client table
  does not name the material; stays out until it does.

## Anti-goals

- A second cost engine that drifts from the planner's.
- A share link that embeds anything private. Only subject, levels and
  buff percentages go in the URL; never stock or account.

## What the page shows (phase B)

Route `#/calculator` (nav label "Calculator"; the planner keeps its own
entry). Left column, the form: kind (building, research, hero, hero gear,
exclusive weapon, vehicle, vehicle part, chip, pet, season building), then
subject (searchable `Select`, both languages), from, to (bounded by the
subject's step range; from defaults to 0 or "not built"), speed bonus %,
cost reduction %. For `exclusive` and `chip`, from/to are rank plus
sub-step as the game shows them ("Red 5★", "0★ 4/10"). For `season
building`, a season picker first.

Right column: `CellGrid` totals, one cell per resource or material plus
time, with the icon when the viewer may read icons. A notes line under the
totals for facts the step data implies (for chips: "N duplicates", "M ×
Big EXP cards"; for exclusives: "red ranks open per season"). Then
`StepTable` with one row per step, costs as columns, time last, folded past
20 rows with "show all N". Two buttons: Copy link, Load into my plan (only
when the viewer has a planner account; it navigates to the planner with
that target added and does not save anything until the planner saves).

URL state: `#/calculator?kind=building&subject=409000&from=28&to=30&speed=35&cost=10`.
Subjects are the catalogue's numeric type ids, not slugs. Parse and
serialise in `features/calculator/url.ts`, fixture tested, tolerant of
missing and out-of-range values (clamp, never throw).

Buff fields show only for kinds where `plan.ts` applies them (building and
research today); for the others they are hidden, not disabled, so the URL
never carries an inert value.

"Load into my plan" shows only for kinds whose planner `Target.subject` is
account-independent: building, research, exclusive, vehicle, vehicle part.
Hero gear and pets key subjects by the account's own gear or pet, and the
planner has no chip kind, so the button is absent there. The planner
takes the calculator's `to` as the target and the account's actual
current level as `from` (the calculator's `from` is a reference choice,
not a claim about the account). Hand-off goes through the hash with a
`target=` parameter that `PlannerPage` reads once on mount and then
strips; the planner saves nothing until its own save action.

## Data work (phase A)

### Reuse

`features/planner/plan.ts` computes step costs with buffs; `levels.ts`
describes level ranges; `format.ts` formats figures. Reference mode
imports them. If any of them is coupled to account state in a way that
blocks stateless use, split the pure part out and keep the planner's
behaviour identical (its tests pin it).

### Vehicle chips

Client tables `car_microchip*` (present in `C:\DW_data\gamedata`; the
builder reads them directly, as the earlier research notes could not be
located in the repo). Extend `dw-collector game-catalog` to write
`game_upgrade_steps` rows with `kind='chip'`, `subject_id` = chip rank
(green, blue, purple, orange), `level` = a flat index over (star, sub-step)
with `name` as the game shows it ("0★ 4/10 → 0★ 5/10"), the way
`exclusive` already flattens rank and sub-step.

`costs` keeps its schema (an array of `{type, id, amount}`; check
constraint and the `Cost` type in `plan.ts`) and gains one type:
`counter`, for quantities that are not items or resources. `id` is a
text key: `chip_exp` for star-up EXP points, `chip_duplicate:<rank>` for a
duplicate of the same chip. The migration widens the check constraint;
`totals()` sums counters by id alongside items and resources; stock
matching in `Breakdown` ignores counters (a player's EXP cards are items,
but EXP points are not held). A notes line under the totals converts:
"129M EXP = 2,152 × Big EXP card (60,000)" using the card item's value
from `game_items`, so the conversion is data, not a constant. Items
referenced by the importer (EXP cards, advanced chip material) must exist
in `game_items`; it reports any missing id and does not invent one.
Commit the Python from the main checkout.

### Season buildings

`_building_steps` in `catalog.py` imports the client's whole `building`
table unfiltered, and 0246 notes that `game_upgrade_steps` already names
season types (868000 Mineral Factory I … 878000). So the likely gap is
grouping, not data. Builder verifies that those rows have populated
`cost_consume` and `time`. If yes: no new kind and no duplicate rows; the
form's "Season building" entry is a filter over `kind='building'` by a
season→type mapping. The mapping comes from the client `building` table's
own season column if one exists (then the importer writes it to a new
nullable `season_id` on the step row); if the table has none, a TS
constant in `features/calculator/seasons.ts` keyed by type id, which is
game fact and small. `season_buildings` (hand-curated, lists only seen
types, not community-readable) is not used for this picker. If costs turn
out empty: the entry is left out of the form and the PR says plainly that
season buildings are outstanding, per the "a verdict is not a promotion"
rule in CLAUDE.md.

### Exclusive weapons

Already `kind='exclusive'`, flat level 1–52. `RankGlyphs.tsx` already has
`weaponSegments` / `weaponText` for the "Red 5★" labels; reuse them in the
from/to pickers.

### Hero gear

Reference mode offers the level track by quality (`level:q5` style
subjects) only. The `promote` (stage-up) track stays out of reference
mode in this project; the planner's hero cards still cover it.

### Access

New kinds inherit the `game_upgrade_*` policies: select for
`authenticated` and community, none for `anon`. pgTAP: community can read
`kind='chip'` rows; anon cannot.

## Constraints

- Migration numbering from `origin/main` at push.
- `game-catalog --dry-run` counts pasted into the PR, including the new
  kinds.
- Language: English UI, as the site is today (user decision 2026-11-08).
  Subject search matches both `name` and `name_ko` so a Korean query
  finds the subject; `fetchCatalogSubjects` must select `name_ko` too.
- Tests: `url.ts` fixtures; a render test for the page with a known
  subject; existing planner tests untouched and green.

## Left to the builder

- Whether chips keep EXP and duplicates as two cost keys or as two
  columns; follow what `StepTable` renders most readably.
- Fold threshold for the step table.
- Whether "Load into my plan" opens the planner in the same tab.

## Decided by Claude, user can override

- Signed-in only, no anon. Keeps RLS as it is and matches the rest of the
  site.
- Reference mode is a sibling route, not a tab inside the planner, so the
  planner's account bar never appears on a page that needs no account.
