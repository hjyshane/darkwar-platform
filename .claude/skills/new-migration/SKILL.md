---
name: new-migration
description: Add a Supabase migration (and its pgTAP test) to the Dark War platform without hitting the traps this repo has already hit — number collisions, RLS without a negative test, select-* view stars, pinned scoring versions. Use whenever you create or change anything under supabase/migrations/ or supabase/tests/.
---

# Adding a migration

The `PostToolUse` hook (`.claude/hooks/guard.mjs`) catches a stale number and
nudges on RLS; this checklist is the part a hook cannot do.

## 1. Number — from `origin/main`, at the moment you push

```bash
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ | sed -E 's#.*/##; s/_.*//' | sort | tail -1
```

File name: `20260728000NNN_snake_case.sql` — the prefix is fixed, `NNN` is highest + 1.
Two branches that took the same "next" number pass CI alone and collide on merge
(0165, 0258, 0262, 0309). Before pushing run `scripts/check-migration-order.sh`;
if you must renumber, change **the file, its pgTAP test, and every comment that
cites the number** (`grep -rn "0NNN" supabase apps services docs`).

## 2. Write it

- Open with a comment block: `-- 0NNN: name - what it is`, then WHY and what it
  deliberately does not do. Recent migrations (0320, 0309) are the model.
- Snapshot tables carry `observation_id`, `source_command`, `parser_version`,
  `idempotency_key` (unique), `captured_at`, `raw jsonb`. Unknown fields go in
  `raw`; promote to a column only once seen consistently.
- `server_id` is the **subject's** server, not the observation's; it leads hot indexes.
- Membership comes from `alliance_roster_latest`, **never** `players.current_alliance_id`
  (last-known, never cleared).
- A query behind a screen that counts **people** must return one row per person
  (PostgREST caps at 1,000 rows; fold detail with `jsonb_object_agg` / `distinct on`).
- `RAISE EXCEPTION` rolls back everything the function wrote — return instead if a
  write (a throttle counter) must survive.
- Adding a column to a table that a view reads with `select *`: **re-create the
  view** (`create or replace`) — the star was expanded when the view was made.
- Big table → think about lock scope and read-time cost first (`docs/runbooks/db-performance.md`).
- Scoring change → **new `scoring_version`**; never overwrite historical scores.
- Changing a column → `grep -rn <column> .` across the **whole repo**, `supabase/tests/` included.

## 3. Test it — `supabase/tests/NN_name_test.sql`

- **RLS / GRANT change → a pgTAP *negative* test** proving the unauthorized read
  fails (spec §20.2). No exceptions.
- **Never pin `scoring_version`** — read `rank_period_latest`.
- **A null-expecting assertion passes when the row is missing.** Assert the row
  exists first (`is(count(*), 1)`), then its null.
- **One `captured_at` per roster batch** in fixtures: `alliance_roster_latest` takes
  the rows sharing the newest instant, so members written a moment apart are a roster of one.
- Don't use global `count(*)` against fixtures; pin fixture uuids (the suite assumes a clean DB).

## 4. Run it

```bash
pnpm db:test:local        # throwaway PostgreSQL 17 + pgTAP; ~8 s on the Mac with PGBIN set (docs/runbooks/mac-setup.md)
```

CI's `db` job is the authority — read it before merging. `supabase test db`,
`pnpm db:types` and `db diff` need Docker/Windows/CI; types are regenerated
there (`scripts/db-types.mjs`), and a committed-types mismatch fails CI.

`db push` to production is the owner's step: say what is pending, do not run it.
