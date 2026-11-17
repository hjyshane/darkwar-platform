# Hive safety — design

Status: draft for the owner's approval, 2026-11-15. Revised the same day after
a builder's read-through (three gaps and one test trap, settled below; every
code citation checked out).
Item 1 of the revised build order in the restructure plan (design review,
2026-11-11). That plan is untracked and lives only at
`C:\darkwar-platform\.claude\worktrees\calculator-reference-1c3c3a\plan\website-restructure-2026-11.md`.
Item 4, the role cut, waits on this one.

## Why

Officers (R4/R5) plan the hive on a PC. When two of them work on the same
plan, one of them loses work without being told, and a deleted plan cannot be
brought back. Before more people get the planner (item 4), the planner has to
stop losing work:

1. **A stale save is refused.** If someone else saved the plan after you
   opened it, your save is refused with a clear message and a way to load
   their version.
2. **Delete can be undone.** A deleted plan goes to "Recently deleted" for 30
   days and an officer can restore it.
3. **Every plan says who last changed it and when.**

Success: two officers editing the same plan never silently lose each other's
work, and a plan deleted by mistake comes back with one press.

## What happens today (read before planning)

Migration numbers are the last four digits of `supabase/migrations/20260728000NNN_*.sql`.

| Piece | Where | Today |
|---|---|---|
| Plan row | `hive_formations` (0165; `alliance_id` 0192/0194) | `name`, `server_id`, `anchor_x/y`, `note`, `is_active`, `created_by` (trigger-stamped), `created_at`, `updated_at`. No editor, no version. |
| Tiles | `hive_formation_slots` (0165, sizes 0169, pins 0174) | Offsets from the anchor, `player_id`, `pinned`, `assigned_by/at` (trigger-stamped). Exclusion constraint: no two tiles share ground. |
| Shape save | `save_hive_formation_layout(uuid, jsonb)` (last 0177) | Definer. Deletes tiles not in the payload, updates changed ones, inserts new ones. Moved tiles get new ids. |
| People save | `assign_hive_formation_slots(uuid, jsonb)` (last 0177) | Definer. Replaces every assignment and pin, keyed by slot id. |
| Board | `hive_formation_board` view (last 0196, `security_invoker`) | One row per tile with the member folded in. |
| Alliance scope | 0194 | Restrictive `alliance_scope` policies plus `guard_alliance` triggers that also catch the definer functions. |
| Editor save | `FormationEditor.tsx:616-664` | Changed shape: **three requests**: save shape, re-read the board, re-save people by offset. People only: one request. Nothing checks for a save in between. |
| Anchor move | `FormationEditor.tsx:666`, `updateFormation` | Direct `update hive_formations` from the browser. |
| Make live | `makeActive` (`hiveFormations.ts:527-538`) | Two direct updates: stand down the old live plan, raise this one. |
| Live refresh | `lib/realtime.ts:42` | Any write to either table invalidates `['hive']`. **When another officer saves a changed shape, this editor's unsaved draft is replaced by their version without a word** (`FormationEditor.tsx:440-446`); unsaved people moves are reset the same way (`:502-535`). An anchor move does not reset the draft (`sameSavedShape`). |
| Delete | `HivePage.tsx:371`, `deleteFormation` | Hard `delete`, cascading to every tile and assignment. Two presses. |

So work is lost **in both directions**: a stale save overwrites the newer
plan, and a newer save wipes the other officer's unsaved draft.

## The owner's decisions (2026-11-15)

- **Deleted plans are kept 30 days**, then removed by a daily cleanup.
- **A stale save is refused; there is no "overwrite anyway".** The refused
  officer keeps their edits on screen until they press "Load their version",
  which drops them.
- **Only hive plans are recoverable.** Saved shapes (templates) and catalogue
  entries keep their current delete.

## Approaches considered

1. **Version number + soft delete + every write through a database function**
   (chosen). A `version` integer on the plan, checked and bumped inside the
   database function that saves. Delete sets `deleted_at` and the row stays.
   The browser loses its direct write access to the plan row (except creating
   one) and to tiles, so an old cached copy of the site cannot go around the
   check.
2. **Check `updated_at` instead of a version.** No new column, but
   `updated_at` also moves on make-live and delete, so another plan's
   stand-down would block someone mid-edit, and comparing timestamps through
   JSON is fragile. Rejected.
3. **Snapshot table for deleted plans (and history).** Copy the plan and its
   tiles into an archive on delete; restore re-inserts them. It is a start on
   version history, but restore has to re-check overlap, map edges, the
   one-live-plan rule and departed members. Much more code than a column for
   the one thing asked. Rejected; history can come later if wanted.

## What counts as what

| Action | Checked against | Bumps `version` | Updates "last changed by" |
|---|---|---|---|
| Save shape and/or people | `version` | yes | yes |
| Move the anchor | the anchor the mover saw (`p_from_x/y`) | no | yes |
| Make live | nothing (can't make a deleted plan live) | no | no |
| Delete | nothing (it can be undone) | no | no (stamps `deleted_by`) |
| Restore | nothing | no (revised during the build, see below) | yes |
| Create | — | starts at 1 | yes (the creator) |

Why the anchor is separate (builder's call, for the owner to check): a save
sends offsets and people, never the anchor, so somebody else moving the anchor
does not make your unsaved draft stale. Blocking you then would throw away
work that is still valid; today's editor already keeps the draft across an
anchor move. Two officers moving the anchor at once are caught by comparing
the anchor each of them saw. The "last changed by" stamp still records an
anchor move, because it changes every member's coordinate.

## Design

### Schema (one migration, number taken from `origin/main` at push time)

New columns on `hive_formations`:

| Column | Meaning |
|---|---|
| `version int not null default 1` | Goes up by one with every saved change to the shape or the people, and on restore. |
| `edited_at timestamptz not null default now()` | When the shape, the people or the anchor last changed. `updated_at` stays as it is. |
| `edited_by uuid references auth.users (id) on delete set null` | Who made that change. |
| `edited_by_name text` | That person's name **at the time**: their character name, else the account's `display_name`, the same order as `post_authors` (0080). Stored rather than joined, so members can read it from the row they already see, with no new view and no new grant. |
| `deleted_at timestamptz` | Null for a live row. Set by delete. |
| `deleted_by uuid references auth.users (id) on delete set null`, `deleted_by_name text` | Who deleted it, for the "Recently deleted" list. |

Existing rows start at `version 1`, `edited_at = updated_at`, `edited_by = created_by`,
and the name resolved from `created_by`.

The existing actor trigger (0165 `hive_formations_set_actor`) also forces, on
insert, `version = 1`, `deleted_* = null`, and `edited_*` = the caller. A
direct insert from the browser therefore cannot forge a version, a stamp or a
deleted plan.

`hive_formation_board` (re-created from its 0196 body) gets
`where f.deleted_at is null` and appends `f.version as formation_version` at
the end, so the editor knows which version a board it is drawing came from.

### Database functions

All `security definer`, `set search_path = ''`, checking `hive.plan`.
Execute is revoked from `public` and `anon` and granted to `authenticated` only
where the browser calls it.

- **`internal.hive_formation_lock(p_formation_id uuid) returns public.hive_formations`**,
  shared by every function below. Locks the plan row (`for update`), so two
  writes arriving together are judged one after the other. **Calls
  `public.refuse_other_alliance(alliance_id)` first** (0194), so another
  alliance's plan is refused with `42501` before anything else can answer. Its
  version check must not leak that the plan exists. Refuses a missing plan
  (`P0002`).
- **`internal.hive_formation_stamp(p_formation_id uuid)`** sets `edited_at`,
  `edited_by` and `edited_by_name` from `auth.uid()`.
- **`public.save_hive_formation(p_formation_id uuid, p_version int, p_slots jsonb, p_assignments jsonb) returns jsonb`**.
  The shape and the people in **one transaction**, replacing the editor's
  three requests. Lock; refuse a deleted plan (`P0002`, "this plan was
  deleted"); refuse `p_version` ≠ `version` (`PT409`, "somebody else saved this
  plan after you opened it"). PostgREST turns `PT409` into HTTP 409, and
  supabase-js passes it through as `error.code`. `p_slots` null means the
  shape is unchanged. Assignments are keyed by **offset** (`{dx, dy,
  player_id, pinned}`) rather than slot id, because a moved tile gets a new
  id. Inside, it calls the existing `save_hive_formation_layout` and then
  `assign_hive_formation_slots`, with ids looked up by offset, so the tested
  logic is reused rather than copied. An assignment naming an offset with no
  tile is refused (`23503`). Then it bumps `version` and stamps. It returns the
  new version, the stamp, and the counts the editor reports today, including
  how many members lost their tile because it was erased. Any raise rolls
  back everything the call wrote, which is what a refused save should do.
- **`public.move_hive_formation(p_formation_id uuid, p_from_x int, p_from_y int, p_to_x int, p_to_y int) returns jsonb`**.
  Lock; refuse a deleted plan; refuse (`PT409`) if the anchor is no longer at
  `p_from`; move; stamp. Returns the stamp. The version is unchanged.
- **`public.make_hive_formation_live(p_formation_id uuid) returns void`**
  replaces `makeActive`'s two requests. In one transaction it stands down this
  alliance's live plan on the same server and raises this one, refusing a
  deleted plan (`P0002`). A refusal can no longer leave the alliance with no
  live plan.
- **`public.delete_hive_formation(p_formation_id uuid) returns void`** sets
  `deleted_at`, `deleted_by`, `deleted_by_name`, and `is_active = false` (a
  deleted plan must not hold the one-live-plan slot).
- **`public.restore_hive_formation(p_formation_id uuid) returns jsonb`** clears
  `deleted_*` and stamps the restorer. The plan comes back **not live**.
  **It keeps the version** (revised during the build, after the final
  review): the plan comes back exactly as it was, and nothing can be saved to
  a deleted plan, so a draft built on that version is still a draft of this
  plan. Bumping it would have told the officer who had the plan open when it
  was deleted that their work was stale, leaving only "Load the new version",
  which drops it.
- **`internal.purge_deleted_hive_formations() returns int`**: hard-deletes
  plans deleted more than 30 days ago; tiles go by cascade. Scheduled daily
  with `cron.schedule('hive-purge-deleted', '41 3 * * *', ...)`, following
  0184. The `where` clause also satisfies production's `pg_safeupdate`.

### Access changes (each gets a pgTAP negative test, with `set local role`)

| Change | Why |
|---|---|
| `member_read` on `hive_formations`: also requires `deleted_at is null or (select public.has_permission('hive.plan'))` | Members never see a deleted plan; officers need to, for the restore list. Their tiles and board rows follow through the existing `alliance_scope` policy on slots and the invoker view. |
| `revoke update, delete on hive_formations from authenticated`; drop `planner_update` and `planner_delete` | Every change after creation goes through a function. A stale copy of the site can no longer stand a plan down, move an anchor or delete for good. Only the cleanup job removes a plan. Insert (create) stays. |
| `revoke insert, update, delete on hive_formation_slots from authenticated`; drop the three `planner_*` write policies | The site never writes tiles directly. Leaving it open would let a stale write go around the version check. Reading is unchanged. |
| `revoke execute on save_hive_formation_layout, assign_hive_formation_slots from public, anon, authenticated` | Same reason: an old cached copy of the site would otherwise save without a check. The new function calls them as their owner. |
| `revoke all on hive_formations, hive_formation_slots from anon`; explicit `revoke execute ... from anon` on every new function | Production grants new routines to `anon` by default (hosted-grants memory). |

### The site

- **`hiveFormations.ts`**: `Formation` gains `version`, `editedAt`,
  `editedByName`, `deletedAt`, `deletedByName`. `fetchFormations` excludes
  deleted plans, except for the officers' hive screen, which asks for the
  last 30 days' deleted plans in the same response (see "Deleted while
  open").
  `BoardSlot` reads gain `formationVersion`. `saveFormation`,
  `moveFormation`, `makeActive`, `deleteFormation` and `restoreFormation`
  call the new functions. A `PT409` error becomes a `StaleSaveError`, so the
  screen can tell it apart.
- **Editor**: the draft remembers the version of the board it was built from.
  When a newer version arrives (live refresh or a refused save):
  - **clean draft**: replaced quietly, as today;
  - **unsaved draft**: kept on screen, Save disabled, and a banner by the
    Save button:

    ```
    Mina changed this plan at 14:32. Your changes can't be saved over theirs.
    [ Load the new version ]   (your unsaved changes will be dropped)
    ```

    The name and time come from the plan's stamp, the latest change.

  The decision is a pure function (clean / unsaved / conflict) with its own
  tests. After this officer's own save, the remembered version becomes the
  one the function returned, so their own refresh is never mistaken for
  someone else's. A refused anchor move says where the anchor is now and
  reloads it; it does not touch the draft.
- **Stamp**: "Last changed by Mina · 14:32" beside the editor's Save button
  and above the list on the plan view that members see. Time in the reader's
  chosen clock (`lib/timezone.ts` `readZone`, server time by default, the
  same setting the alarms screen uses), with the date added when it is not
  today.
- **Delete**: one press now asks "Delete *name*? It can be restored for 30
  days." On confirm the plan leaves the list.
- **Recently deleted**: officers only. A collapsed section beside "Start a new
  formation":

  ```
  ▸ Recently deleted (2)
      Bear rally · server 580 · deleted by Mina, 12 Nov · kept until 12 Dec  [Restore]
      Hive move 11-03 · server 580 · deleted by Dex, 4 Nov · kept until 4 Dec [Restore]
  ```

- **Deleted while open** (added during the build, after the final review): if
  somebody else deletes the plan on screen, the screen stays on it rather than
  moving to another plan and taking the unsaved draft with it. A notice says
  who deleted it and offers "Restore it"; the board stops refreshing (the
  board view leaves deleted plans out) so the draft stays. Officers' live and
  deleted plans come from one query, so a plan never sits in neither list
  between two refreshes. When this officer deletes it themselves, the screen
  moves on as before.

### Deploy order

The migration takes away the old site's write paths, so between the owner's
`supabase db push` and the merge that deploys the new site, **saving, moving,
making live and deleting a hive on cbfw.us fail** (reading still works). The
new site reads new columns, so it must not go live before the push either.
The order, as the brief for this piece requires: owner pushes, then merge
right away.

## Testing

- **pgTAP** (new file). Existing hive tests that save through the old
  functions or write plans or tiles as `authenticated` move onto the new
  functions. In particular `103_alliance_content_stays_home_test.sql:137-142`
  would stay green for the wrong reason ("permission denied for function"), so
  it is rewritten against `save_hive_formation`.
  - Version bumps on save. A stale save is refused with nothing written.
  - Anchor: the move's from-check is refused when stale. An anchor move
    leaves the version alone, so a save still succeeds after it. Two officers
    in turn get the right stamp.
  - Make-live: atomic; a deleted plan is refused and the live plan stays
    live; the version is untouched.
  - Delete hides the plan, its tiles and its board rows from a member; an
    officer still sees it. Direct `update`/`delete` on plans and direct tile
    writes are refused.
  - A direct insert cannot forge `version`, `edited_*` or `deleted_at`.
  - Restore brings the plan back not live, at the same version.
  - The cleanup removes plans deleted 31 days ago and keeps one deleted 29
    days ago and every live plan.
  - A member gets `42501` from every new function; anon can execute none of
    them, nor the two old ones.
  - Another alliance's plan is refused with `42501` even when the version
    matches.
- **Dashboard** (vitest, pure functions in the existing style): the
  clean/unsaved/conflict decision (including "anchor moved, draft kept"),
  `PT409` mapped to `StaleSaveError`, the stamp text (today / another day /
  unknown editor), and the kept-until date and the 30-day cut-off of the
  deleted list.
- `pnpm check && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:test:local`,
  `scripts/check-migration-order.sh`. Hand-edited `database.types.ts` (no
  Docker): new columns, view column and functions, checked by CI's `db` job.

## Not in this piece

Undo/redo, a save-state pill with "Unsaved changes" (§6, item 3), version
history, renaming from the site, recoverable templates, real-time
"someone is editing now" presence, and Discord posting.

## Left to the builder

The exact banner and stamp wording within the lines above; whether the lost-tile
count is computed in SQL or from the returned counts; where in the page the
"Recently deleted" section sits. (What the editor shows if the plan it has
open is deleted under it was left here too; it is now decided above, under
"Deleted while open".)
