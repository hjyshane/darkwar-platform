# Hive safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Officers editing the same hive plan can no longer silently lose each other's work: stale saves are refused, deleted plans can be restored for 30 days, and every plan shows who last changed it and when.

**Architecture:** One migration adds `version`, an "edited by" stamp and soft-delete columns to `hive_formations`. It moves every write after creation into definer functions that lock the row and check the version, and takes away the browser's direct UPDATE/DELETE on plans and every direct tile write. The dashboard calls the new functions, remembers which version its draft came from, keeps an unsaved draft on screen when someone else saves, and adds a stamp and a "Recently deleted" list.

**Tech Stack:** PostgreSQL 17 / Supabase (RLS, PostgREST, pg_cron), pgTAP; React + TanStack Query + supabase-js, vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-15-hive-safety-design.md` (owner-approved 2026-11-15). Read its "What counts as what" table before any task.

## Global Constraints

- Migration file: `supabase/migrations/20260728000330_hive_safety.sql`; pgTAP file: `supabase/tests/330_hive_safety_test.sql`. **Before pushing, re-take the number from `origin/main`** (`git fetch && git ls-tree --name-only origin/main supabase/migrations/ | tail -1`). Run `scripts/check-migration-order.sh`; on a clash, renumber the file, its test and every comment citing 0330.
- Retention: **30 days** (`interval '30 days'`); cron job name `hive-purge-deleted`, schedule `'41 3 * * *'`.
- Stale-version error: `errcode = 'PT409'`, message `somebody else saved this plan after you opened it`. Stale anchor: `PT409`, message `the anchor was moved after you opened this plan`. Deleted plan: `P0002`, message `this plan was deleted`. Missing plan: `P0002`, `no such formation`. Permission: `42501`.
- Every new definer function: `security definer`, `set search_path = ''`, checks `public.has_permission('hive.plan')` first (42501). `revoke all on function … from public, anon;` then `grant execute … to authenticated` for the five public ones only. `internal.*`: also revoke from `authenticated`.
- Policies wrap function calls in `(select …)` (0179 rule) and never mention `community` (111 test).
- Every `update`/`delete` the migration or a function issues has a `where` (production runs `pg_safeupdate`).
- Name stamp = `coalesce(players.current_name, app_users.display_name)` for `auth.uid()`; null when neither exists. UI shows null as "someone".
- Times shown in `readZone()` (`lib/timezone.ts`), via `zonedTime`/`zonedDayKey`.
- Banner copy: `{name} changed this plan at {time}. Your changes can't be saved over theirs.` Button: `Load the new version`, with the note `(your unsaved changes will be dropped)`. Stamp copy: `Last changed by {name} · {time}`. Delete confirm: `Delete {plan name}? It can be restored for 30 days.`
- No commits or pushes until the owner says so (the brief for this piece). Never run `supabase db push`; the owner runs it.

## Review Focus

1. **The officer's own save refreshing back.** After a successful save the board refetch must not show the conflict banner, even if the live refresh lands before `onSuccess`. Pinned in Task 4 (`draftStatus` cases) and Task 6.
2. **A plan with no tiles yet.** No board rows, so no `formation_version` on the board; the editor must fall back to `formation.version`, and the first save must work. Pinned in Task 2 (pgTAP: empty plan, `p_slots` with tiles and `p_assignments '[]'`) and Task 4 (`boardVersionOf`).
3. **Pressing Delete twice / Restore on a plan that is not deleted.** No-ops, not errors. Pinned in Task 1 (pgTAP).
4. **An assignment naming a structure tile or an offset with no tile.** Refused with the plan unchanged (version too). Pinned in Task 2 (pgTAP).
5. **Making a restored plan live while another plan is live.** The other plan stands down in the same call; never two live, never none. Pinned in Task 2 (pgTAP).

---

### Task 1: Columns, stamp, soft delete, restore, purge, read policy

**Files:**
- Create: `supabase/migrations/20260728000330_hive_safety.sql` (first half)
- Create: `supabase/tests/330_hive_safety_test.sql` (first half)

**Interfaces:**
- Produces (SQL):
  - Columns on `public.hive_formations`: `version int not null default 1`, `edited_at timestamptz not null default now()`, `edited_by uuid references auth.users (id) on delete set null`, `edited_by_name text`, `deleted_at timestamptz`, `deleted_by uuid references auth.users (id) on delete set null`, `deleted_by_name text`.
  - `internal.hive_actor_name() returns text` (stable, definer).
  - `internal.hive_formation_lock(p_formation_id uuid) returns public.hive_formations`: has_permission check; `select … for update`; P0002 if missing; then `perform public.refuse_other_alliance(row.alliance_id)`; returns the row. Does **not** refuse a deleted row (restore needs it).
  - `internal.hive_formation_stamp(p_formation_id uuid) returns void`: sets `edited_at = now()`, `edited_by = auth.uid()`, `edited_by_name = internal.hive_actor_name()`.
  - `public.delete_hive_formation(p_formation_id uuid) returns void`.
  - `public.restore_hive_formation(p_formation_id uuid) returns jsonb` → `{version, edited_at, edited_by_name}`.
  - `internal.purge_deleted_hive_formations() returns int` (rows removed).
  - View `public.hive_formation_board`: 0196 body + `where f.deleted_at is null`, appended last column `f.version as formation_version`.

- [ ] **Step 1: Write the failing pgTAP tests (first half of 329).** Fixture style copies `91_hive_formation_test.sql:131-151` (users `…f301` viewer, `…f302` member, `…f303` officer with `display_name`, plus a second officer `…f304` linked to a player named `Mina` via `app_users.player_id`; `pg_temp.act_as`). Assertions, each with this exact intent:
  - `has_column` for all seven columns; `col_default_is('hive_formations','version','1')`.
  - Insert as owner with claims of `…f303` → `edited_by = …f303`, `edited_by_name = 'hive officer'`, `version = 1`; a direct insert passing `version = 9, deleted_at = now(), edited_by_name = 'forged'` stores `1`, null, `'hive officer'`.
  - As `…f304`: stamp name is `'Mina'` (character name wins over display_name).
  - `delete_hive_formation` on a live plan: `deleted_at` set, `deleted_by_name` stamped, `is_active = false`, `version` unchanged; calling it again `lives_ok` and changes nothing (Review Focus 3).
  - `set local role authenticated` + member claims: `hive_formations`, `hive_formation_slots` and `hive_formation_board` each return 0 rows for the deleted plan (RLS negative test); officer claims: the plan row is visible with `deleted_at` not null, but `hive_formation_board` returns 0 rows for it.
  - Member calling `delete_hive_formation` / `restore_hive_formation` → `throws_ok … '42501'`.
  - `restore_hive_formation`: `deleted_*` null, `is_active = false`, `version` = old + 1, stamp = restorer; on a plan that is not deleted, `lives_ok` and version unchanged (Review Focus 3); on a random uuid, `throws_ok … 'P0002'`.
  - Purge: three plans with `deleted_at` = now() − 31 days, now() − 29 days, null (set as owner); `internal.purge_deleted_hive_formations()` returns 1; only the 31-day one is gone, its slots with it.
  - `ok(exists(select 1 from cron.job where jobname = 'hive-purge-deleted'))` — skip if the stub has no `cron.job` table (check `scripts/pgtap/supabase-stub.sql:66`; if it only stubs the function, assert via `pg_proc`/function existence instead).
  - `has_function_privilege('anon', 'public.delete_hive_formation(uuid)', 'execute')` is false; same for restore; `has_function_privilege('authenticated', 'internal.purge_deleted_hive_formations()', 'execute')` is false.

- [ ] **Step 2: Run, expect failures:** `pnpm db:test:local` → 329 fails (missing columns/functions); every other file still passes.

- [ ] **Step 3: Write the first half of the migration.** Columns; backfill existing rows (`edited_at = updated_at`, `edited_by = created_by`, name from `created_by`) with `where formation_id is not null`; `create or replace function public.hive_formations_set_actor()` keeping 0165's `created_by` rule and adding, on INSERT only, `version := 1`, `deleted_at/deleted_by/deleted_by_name := null`, `edited_* :=` caller; the helpers and functions above; the view; the cron schedule; then the read policy:
  ```sql
  drop policy member_read on public.hive_formations;
  create policy member_read on public.hive_formations
    for select to authenticated
    using ((select public.current_app_role()) in ('member', 'officer', 'admin')
           and (deleted_at is null or (select public.has_permission('hive.plan'))));
  ```
  A header comment in the repo's style says why (spec "Why" and "What counts as what"), and that delete/restore deliberately do not check the version.

- [ ] **Step 4: Run, expect pass:** `pnpm db:test:local` → 329's first half and all 110+ other files pass.

### Task 2: Checked writes and the closed doors

**Files:**
- Modify: `supabase/migrations/20260728000330_hive_safety.sql` (second half)
- Modify: `supabase/tests/330_hive_safety_test.sql` (second half)
- Modify: `supabase/tests/91_hive_formation_test.sql:383-590` (calls as `authenticated`), `supabase/tests/103_alliance_content_stays_home_test.sql:137-158`

**Interfaces:**
- Consumes: Task 1's `internal.hive_formation_lock`, `internal.hive_formation_stamp`.
- Produces (SQL, all granted to `authenticated`):
  - `public.save_hive_formation(p_formation_id uuid, p_version int, p_slots jsonb, p_assignments jsonb) returns jsonb` → `{version, edited_at, edited_by_name, slots, added, changed, removed, unassigned, assigned, lost}`. `p_slots` null = shape unchanged; `p_assignments` null = people unchanged; both null → `22023`. `p_assignments` items `{dx, dy, player_id, pinned}`; every slot of the plan not named is emptied (same as `assign_hive_formation_slots` today). `lost` = members who stood on a tile this call removed and stand nowhere after it.
  - `public.move_hive_formation(p_formation_id uuid, p_from_x int, p_from_y int, p_to_x int, p_to_y int) returns jsonb` → `{anchor_x, anchor_y, edited_at, edited_by_name}`.
  - `public.make_hive_formation_live(p_formation_id uuid) returns void`.

- [ ] **Step 1: Write the failing pgTAP tests (second half of 329).** As officer `…f303` unless stated:
  - Empty plan at version 1: `save_hive_formation(id, 1, '[{"dx":0,"dy":0},{"dx":3,"dy":0}]', '[]')` → `version` 2, 2 tiles, stamp `'hive officer'` (Review Focus 2).
  - Same call with `p_version` 1 again → `throws_ok … 'PT409'`; tile count still 2, version still 2.
  - People only: `save_hive_formation(id, 2, null, '[{"dx":0,"dy":0,"player_id":"<Alpha>","pinned":true}]')` → Alpha on (0,0) pinned, (3,0) empty, version 3.
  - Shape change carrying people: move (0,0)→(6,0) in `p_slots` and name Alpha at (6,0) in `p_assignments` → Alpha on (6,0), `lost` 0. Then remove (6,0) from `p_slots` with Alpha not named → `lost` 1.
  - Assignment at an offset with no tile → `throws_ok … '23503'`; assignment on a `kind = 'structure'` tile → `throws_ok` (constraint code `23514`); in both, version and tiles unchanged (Review Focus 4).
  - Both params null → `throws_ok … '22023'`.
  - Deleted plan → `throws_ok … 'P0002'`.
  - `move_hive_formation(id, 500, 500, 510, 500)` → anchor 510, version unchanged, stamp = mover; a second officer `…f304` then moving `from 500,500` → `throws_ok … 'PT409'`; a save at the current version still `lives_ok` after the move.
  - `make_hive_formation_live`: plan A live, B not; make B live → A false, B true, both versions unchanged; on a deleted plan → `throws_ok … 'P0002'` and A stays live; restore a deleted plan and make it live while A is live → A stood down (Review Focus 5).
  - `set local role authenticated` + officer claims: `update public.hive_formations set anchor_x = 1` → `throws_ok … '42501'`; same for `set is_active = true`, `delete from public.hive_formations …`, `insert into/update/delete public.hive_formation_slots …`; `select public.save_hive_formation_layout(…)` and `public.assign_hive_formation_slots(…)` → `42501`; direct `insert into public.hive_formations` still `lives_ok`.
  - Member claims: each of the three new functions → `42501`.
  - Anon: `has_function_privilege('anon', …, 'execute')` false for the three new functions and the two old ones.
  - Another alliance (copy 103's two-alliance fixture, `103:50-70`): `save_hive_formation` on the other alliance's plan **with its correct version** → `throws_ok … '42501'`.

- [ ] **Step 2: Run, expect failures:** `pnpm db:test:local` → 329 second half fails.

- [ ] **Step 3: Write the second half of the migration.** `save_hive_formation`: lock; refuse deleted; compare version; snapshot the players on tiles whose offset is absent from `p_slots`; `perform`-style call `public.save_hive_formation_layout` (keep its summary); build `{slot_id, player_id, pinned}` for **every** tile of the plan by joining `p_assignments` on `(dx, dy)` (refuse unmatched payload offsets with 23503 first); call `public.assign_hive_formation_slots`; `update … set version = version + 1 where formation_id = p_formation_id`; stamp; return. `make_hive_formation_live`: stand down `where server_id = f.server_id and alliance_id is not distinct from f.alliance_id and is_active and formation_id <> f.formation_id` (mirrors the 0194 unique index), then raise this one. Then the doors:
  ```sql
  drop policy planner_update on public.hive_formations;
  drop policy planner_delete on public.hive_formations;
  drop policy planner_insert on public.hive_formation_slots;
  drop policy planner_update on public.hive_formation_slots;
  drop policy planner_delete on public.hive_formation_slots;
  revoke update, delete, truncate on public.hive_formations from authenticated;
  revoke insert, update, delete, truncate on public.hive_formation_slots from authenticated;
  revoke all on public.hive_formations, public.hive_formation_slots from anon;
  revoke execute on function public.save_hive_formation_layout(uuid, jsonb) from public, anon, authenticated;
  revoke execute on function public.assign_hive_formation_slots(uuid, jsonb) from public, anon, authenticated;
  ```

- [ ] **Step 4: Move the old tests onto the new doors.**
  - `91:383-590`: the member/officer negative checks stay under `set local role authenticated`. Where an officer exercises `save_hive_formation_layout`/`assign_hive_formation_slots` behaviour (pins, overlap wording, the 1000-tile size gate), wrap that block in `reset role;` … `set local role authenticated;` so the owner runs it with the officer's claims (claims survive `reset role`, see `103:161-163`). Change `91:412-416` ("an officer can") to assert the officer now gets `42501` from the old function as `authenticated`. Change `91:426` (direct `update … set pinned`) to expect `42501`, the new reason. Re-count `plan(N)`.
  - `103:137-158`: test 13 calls `save_hive_formation(… '0d4001', <its version>, …)` and expects `42501`; test 14 calls `save_hive_formation(… '0d4002', 1, …)` with `lives_ok`; test 15 becomes `delete_hive_formation('…0d4002')` with `lives_ok`, plus `reset role` and `internal.purge_deleted_hive_formations()` after back-dating `deleted_at` 31 days, `lives_ok` (the cascade the old test guarded now runs here).

- [ ] **Step 5: Run, expect pass:** `pnpm db:test:local` → all files pass, including 91, 103 and 329.

### Task 3: Generated types by hand

**Files:**
- Modify: `packages/shared-types/src/database.types.ts` (`hive_formations` ≈5138, `hive_formation_board` ≈9758, Functions block)

**Interfaces:**
- Produces: TS types for the seven columns (Row non-null where the column is `not null`; Insert/Update optional), `hive_formation_board.Row.formation_version: number | null`, and Functions entries in alphabetical order:
  - `delete_hive_formation: { Args: { p_formation_id: string }; Returns: undefined }`
  - `make_hive_formation_live: { Args: { p_formation_id: string }; Returns: undefined }`
  - `move_hive_formation: { Args: { p_formation_id: string; p_from_x: number; p_from_y: number; p_to_x: number; p_to_y: number }; Returns: Json }`
  - `restore_hive_formation: { Args: { p_formation_id: string }; Returns: Json }`
  - `save_hive_formation: { Args: { p_assignments: Json; p_formation_id: string; p_slots: Json; p_version: number }; Returns: Json }`

- [ ] **Step 1:** Add the columns and functions following `memory/hand-edited-types-generator-quirks.md`: the two new FKs to `auth.users` become Relationships `hive_formations_deleted_by_fkey` and `hive_formations_edited_by_fkey` → `pending_access`/`user_id`, placed in foreignKeyName order between `created_by` and `server_id`; short signatures go on one line exactly as above; the old two functions stay listed (they still exist).
- [ ] **Step 2:** `pnpm typecheck` → passes (nothing reads the new fields yet). CI's `db` job is the real check; if it fails after a push, apply its printed diff.

### Task 4: Pure decisions — `hiveSafety.ts`

**Files:**
- Create: `apps/dashboard/src/features/hive/hiveSafety.ts`
- Create: `apps/dashboard/src/features/hive/hiveSafety.test.ts`

**Interfaces:**
- Produces:
  - `export const KEEP_DELETED_DAYS = 30`
  - `export class StaleSaveError extends Error { readonly kind: 'version' | 'anchor' }`
  - `export class PlanDeletedError extends Error {}`
  - `export function toWriteError(error: { code?: string; message: string }): Error` — `PT409` with the anchor message → `StaleSaveError('anchor')`, other `PT409` → `StaleSaveError('version')`, `P0002` with `deleted` in the message → `PlanDeletedError`, else `new Error(message)`.
  - `export type DraftStatus = 'current' | 'behind' | 'conflict'`
  - `export function draftStatus(input: { unsaved: boolean; baseVersion: number; boardVersion: number }): DraftStatus` — `boardVersion <= baseVersion` → `'current'`; newer and `!unsaved` → `'behind'`; newer and `unsaved` → `'conflict'`.
  - `export function boardVersionOf(slots: readonly { formationVersion: number | null }[], formationVersion: number): number` — the first non-null `formationVersion`, else `formationVersion`.
  - `export interface OffsetAssignment { dx: number; dy: number; player_id: string | null; pinned: boolean }`
  - `export function peopleByOffset(tiles: readonly Offset[], placements: ReadonlyMap<string, { playerId: string; pinned: boolean }>): OffsetAssignment[]` — one entry per tile, keyed with `offsetKey` from `lib/hiveFormation`.
  - `export function stampText(name: string | null, at: string, zone: string, now: Date): string` — `Last changed by Mina · 14:32`; another day → `Last changed by Mina · 12 Nov 14:32`; null name → `someone`.
  - `export function keptUntil(deletedAt: string): Date` and `export function stillRestorable(deletedAt: string, now: Date): boolean` (strictly less than 30 days).

- [ ] **Step 1: Write the failing tests** in the style of `hiveFormations.test.ts`:
  - `draftStatus`: `{unsaved:false, base:3, board:3}` → current; `{false,3,4}` → behind; `{true,3,4}` → conflict; `{true,4,4}` → current (own save, Review Focus 1); `{true,5,4}` → current (base set from the save's response before the refetch lands).
  - `boardVersionOf([], 7)` → 7 (Review Focus 2); `[{formationVersion: 9}]`, 7 → 9.
  - `toWriteError({code:'PT409', message:'somebody else saved this plan after you opened it'})` is a `StaleSaveError` with kind `'version'`; the anchor message → kind `'anchor'`; `{code:'P0002', message:'this plan was deleted'}` → `PlanDeletedError`; `{code:'23514', message:'x'}` → plain `Error` with message `'x'`.
  - `peopleByOffset([{dx:0,dy:0},{dx:3,dy:0}], new Map([['0,0', {playerId:'p1', pinned:true}]]))` → `[{dx:0,dy:0,player_id:'p1',pinned:true},{dx:3,dy:0,player_id:null,pinned:false}]` (use the real `offsetKey` to build the map key).
  - `stampText('Mina', '2026-11-15T16:32:00Z', 'UTC', new Date('2026-11-15T18:00:00Z'))` → `'Last changed by Mina · 16:32'`; a day earlier → contains `'14 Nov'`; `null` name → starts `'Last changed by someone'`.
  - `keptUntil('2026-11-12T10:00:00Z')` → `2026-12-12T10:00:00Z`; `stillRestorable` true at +29 days, false at +30 days.
- [ ] **Step 2:** `pnpm --filter dashboard exec vitest run src/features/hive/hiveSafety.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. `stampText` uses `zonedTime`/`zonedDayKey` from `lib/timezone.ts`; the date part via `Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone: zone})`.
- [ ] **Step 4:** Same command → PASS.

### Task 5: Data layer

**Files:**
- Modify: `apps/dashboard/src/features/hive/hiveFormations.ts`
- Modify: `apps/dashboard/src/features/hive/hiveFormations.test.ts` (only if a pure mapper is extracted)

**Interfaces:**
- Consumes: Task 3 types; Task 4 `toWriteError`, `OffsetAssignment`, `KEEP_DELETED_DAYS`.
- Produces:
  - `Formation` gains `version: number; editedAt: string; editedByName: string | null; deletedAt: string | null; deletedByName: string | null`.
  - `BoardSlot` gains `formationVersion: number | null`.
  - `fetchFormations` adds `.is('deleted_at', null)` and the new columns.
  - `fetchDeletedFormations(): Promise<Formation[]>` (`deleted_at` within the last `KEEP_DELETED_DAYS` days, newest first, limit 100) and `useDeletedFormations(enabled: boolean)` with key `['hive', 'deleted']`.
  - `saveFormation(formationId: string, version: number, slots: readonly LayoutTile[] | null, people: readonly OffsetAssignment[] | null): Promise<FormationSaveResult>` where `FormationSaveResult = LayoutSummary & { version: number; editedAt: string; editedByName: string | null; assigned: number; lost: number }`.
  - `moveFormation(formationId: string, from: Coordinate, to: Coordinate): Promise<void>`
  - `makeActive(formationId: string): Promise<void>` (one RPC; the `serverId` argument goes).
  - `deleteFormation(formationId: string): Promise<void>` (RPC).
  - `restoreFormation(formationId: string): Promise<void>`.
  - Every one of these throws `toWriteError(error)`.
  - Removed: `saveLayout`, `saveAssignments`, `updateFormation`, `AssignmentSummary`.

- [ ] **Step 1:** Make the changes. `fetchBoard` selects `formation_version`.
- [ ] **Step 2:** `pnpm typecheck` → the only errors are the editor and page call sites Tasks 6 and 7 fix. Note them; do not paper over them here.

### Task 6: Editor — version tracking, conflict banner, stamp

**Files:**
- Modify: `apps/dashboard/src/features/hive/FormationEditor.tsx` (`:433-549` state, `:616-690` mutations, `:800-806` `saveEverything`, `:1335-1357` `saveActions`)
- Create: `apps/dashboard/src/features/hive/HiveStamp.tsx` (`Stamp` and `ConflictBanner`, small presentational components)

**Interfaces:**
- Consumes: Task 4 `draftStatus`, `boardVersionOf`, `peopleByOffset`, `stampText`, `StaleSaveError`, `PlanDeletedError`; Task 5 `saveFormation`, `moveFormation`.
- Produces: `export function Stamp({ name, at }: { name: string | null; at: string }): JSX.Element`; `export function ConflictBanner({ name, at, onLoad }: { name: string | null; at: string; onLoad: () => void }): JSX.Element`.

- [ ] **Step 1: Version state.** `const boardVersion = boardVersionOf(slots, formation.version)`; `const [baseVersion, setBaseVersion] = useState(boardVersion)`. In the `draftFor !== saved` block (`:440`), compute `draftStatus` with `unsaved` judged against the **previous** saved draft (`draftFor`) and the previous `assignmentsFor`: `'behind'` → adopt the board as today and `setBaseVersion(boardVersion)`; `'conflict'` → keep the draft and the assignments untouched; `'current'` → today's `sameSavedShape` rule. Apply the same guard to the assignment reset at `:502-535`.
- [ ] **Step 2: One save.** Replace `layoutSave` and `assignmentSave` with one `save` mutation: shape changed → `saveFormation(id, baseVersion, layoutForSave(), peopleByOffset(orderedDraft(), placementsOf(orderedDraft(), assignments, pinned)))`; people only → `saveFormation(id, baseVersion, null, peopleByOffset(slots, placementsOf(slots, assignments, pinned)))` (a `BoardSlot` already carries `slotId`, `dx`, `dy`). `onSuccess`: `setBaseVersion(result.version)` **before** invalidating `['hive']`; the lost-tile message uses `result.lost`. `onError`: `StaleSaveError` → clear `refusal`, invalidate `['hive']` (the banner appears when the newer board lands); `PlanDeletedError` → refusal `This plan was deleted. An officer can restore it from Recently deleted.`; anything else → `refusal = message`.
- [ ] **Step 3: Anchor.** `anchorMove` calls `moveFormation(id, anchorBeforeTheMove, to)`. A `StaleSaveError('anchor')` sets refusal `Someone else moved this plan's anchor. It has been reloaded.` and invalidates; the draft is untouched.
- [ ] **Step 4: Banner and stamp.** When `boardVersion > baseVersion && unsaved`, render `ConflictBanner` above `saveActions` (name/time from `formation.editedByName`/`formation.editedAt`) and disable Save. `onLoad`: `setDraft(saved)`, reset assignments and pins from `slots` exactly as `:505-534` does, `setBaseVersion(boardVersion)`, clear refusal. Render `Stamp` beside the Save button.
- [ ] **Step 5:** `pnpm typecheck && pnpm --filter dashboard exec vitest run src/features/hive` → editor errors gone; existing `FormationEditor.test.ts`/`anchorMove.test.ts` still pass (update any that reference removed exports).

### Task 7: Page — delete, restore, make live, stamp for members

**Files:**
- Modify: `apps/dashboard/src/features/hive/HivePage.tsx` (`:216-233`, `:367-374`, `:461-518`)
- Create: `apps/dashboard/src/features/hive/RecentlyDeleted.tsx`

**Interfaces:**
- Consumes: Task 5 `makeActive(formationId)`, `deleteFormation`, `restoreFormation`, `useDeletedFormations`; Task 4 `keptUntil`, `stampText`; Task 6 `Stamp`.
- Produces: `export function RecentlyDeleted({ onRestored }: { onRestored: (formationId: string) => void }): JSX.Element | null` — renders nothing when the list is empty.

- [ ] **Step 1:** `stand` calls `makeActive(formation.formationId)`. The delete confirm label becomes `Delete {name}? It can be restored for 30 days.`, and the comment at `:497-500` is updated (there is now history to recover from). Mutation errors show under the actions (today they are silent).
- [ ] **Step 2:** `Overview` renders `<Stamp name={formation.editedByName} at={formation.editedAt} />` above the list, for members too.
- [ ] **Step 3:** `RecentlyDeleted`: a `<details className="hive-new">` with summary `Recently deleted ({n})`; one row per plan: `{name} · server {serverId} · deleted by {deletedByName ?? 'someone'}, {date} · kept until {date}` plus a `Restore` button calling `restoreFormation`, then `onRestored(id)` and invalidating `['hive']`. Mounted beside `NewFormation` under the same `mayPlan` condition (`:227`), so members never see it.
- [ ] **Step 4:** `pnpm typecheck` → clean.

### Task 8: Dev fixtures, preview check, full gate

**Files:**
- Modify: `apps/dashboard/src/dev/fixtures.ts` (`HIVE_FORMATIONS` ≈759, `HIVE_SLOTS`, and an `['hive', 'deleted']` entry with one deleted plan)

- [ ] **Step 1:** Add the new `Formation`/`BoardSlot` fields to the fixtures (`version: 3`, `editedByName: 'Mina'`, a recent `editedAt`, `formationVersion: 3`) and one deleted plan.
- [ ] **Step 2:** Preview with the `run-dashboard` skill as officer and as member: the stamp shows on the plan view and beside Save; "Recently deleted (1)" shows for the officer only; the delete confirm reads as specified; nothing overflows at 375 px.
- [ ] **Step 3: Full gate.**
  ```
  pnpm check && pnpm typecheck && pnpm test && pnpm build
  pnpm db:test:local
  bash scripts/check-migration-order.sh
  ```
  Expected: all green; `db:test:local` reports every file passing.
- [ ] **Step 4:** Ask the owner whether to commit and open the PR. The PR body states the deploy order from the spec: owner runs `supabase db push --linked --workdir C:\darkwar-platform`, then merge right away. After the push, check prod grants with `supabase db query --linked` (`has_function_privilege('anon', …)` for the five new functions; `relacl` of `hive_formations` and `hive_formation_slots`).
