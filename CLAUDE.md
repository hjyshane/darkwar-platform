# Working in this repo

Personal, private tooling for Dark War Survival server group 577-584. Solo
developer, AI-assisted. The spec at
`docs/DarkWar_Platform_Technical_Specification_v1.0.md` is the source of truth
for requirements; when this file and the spec disagree about *process*, this
file wins — it reflects decisions made after the spec was written.

**Start here if you are picking this up: `docs/handover.md`.** It says where
the work stopped, what is blocked and why, and — importantly — which parts
have never been run against real data.

## Decisions already made — do not relitigate

- **Development is Windows-only.** No WSL. Capture, BlueStacks, and ADB are
  native Windows; the collector must hold them in one process tree. CI runs on
  Linux specifically to catch case-sensitivity and path assumptions.
- **The spec's Appendix C layout was deliberately trimmed.** `modules/` is not
  created, ever — every one of its nine names already has a home in
  `services/`, `supabase/migrations/`, or `apps/dashboard/src/features/`.
  Do not scaffold it back from the spec.
- **`services/` holds one Python package**, not four. Spec §10.1 asks for
  *process* separation; that is satisfied by four console entrypoints
  (`dw-capture`, `dw-sync`, `dw-jobs`, `dw-ui-worker`) sharing one package.
- **Create directories on first use.** `supabase/functions/`, `docs/adr/`,
  `docs/runbooks/`, `packages/ui`, `packages/api-client`,
  `packages/scoring-explain`, `services/analysis-worker` do not exist yet and
  should not be created until something actually goes in them.

## Not being built yet

The event framework (§13), season framework and map crawler (§14), and battle
report pipeline (§15) rest on unconfirmed protocol — §5.3 lists eight open
items and §26.1 lists the PCAPs still needed. Their tables are deliberately
absent from the schema. Do not add them speculatively; fields would be guesses.

Also deferred: PGMQ queues, Supabase Storage, table partitioning, alerting
(§18.4), and Playwright.

## Merging to `main` publishes the dashboard

Cloudflare's own Git integration is connected to this repository and builds on
push — no GitHub Actions involved, which is why this still works while the
Actions runs fail on billing in four seconds. The build for a `main` commit is
what serves `https://cbfw.us`. Every merged PR is a production release, within
about a minute, whether or not anybody meant it as one.

This is NOT the pipeline §21.1 asks for and the spec's item stays open: there
is no gate in front of it. The Actions run is red on every commit, so nothing
stops a merge that fails `pnpm test` from going straight out. **The local gate
is the only gate** — run it before merging, not before pushing.

The build's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` live in
Cloudflare's build settings, which is why neither appears in any `.env` here.
A local `pnpm build` has no such values and falls back to the local stack
defaults in `apps/dashboard/src/lib/env.ts`; that `dist/` points at
`127.0.0.1:54321` and must never be deployed by hand.

`docs/runbooks/going-public.md` §6 has the manual `wrangler deploy` path, for
when the automatic build is what broke.

## The Observation seam

The collector's upstream boundary is an `Observation` object, not a socket.
Everything downstream — router, normalizer, SQLite journal, outbox, sync,
Supabase, Realtime, UI — is written against `Observation` and tested with
hand-authored fixtures. Live capture is just one producer of `Observation`s.

This is why the pipeline can be built and regression-tested without Npcap or
BlueStacks. Keep it that way: nothing below `capture/` may import scapy or
assume a live socket.

## Schema conventions

Every snapshot table carries `observation_id`, `source_command`,
`parser_version`, `idempotency_key` (unique), `captured_at`, and `raw jsonb`.
Unrecognized parser fields land in `raw` with no migration; promote a key to a
typed column only after it has been observed consistently.

- **Hash the raw decoded payload for `idempotency_key`, never the normalized
  row.** Hashing the normalized row means every parser version bump produces
  new keys and duplicates all history on replay. There is a regression test
  pinning this.
- **`server_id` is the subject's server, not the observation's.** A
  `server.rank` response captured from 580 contains players from all eight
  servers. Provenance goes in `collector_id` / `collected_from_server_id`.
- **`server_id` leads hot indexes.** The group grows to 12/16/32/64 servers.
- **Membership comes from `alliance_roster_latest`, never from
  `players.current_alliance_id`.** That column is a LAST KNOWN alliance: every
  writer since 0008 sets it with `coalesce(s.alliance_id, p.current_alliance_id)`
  and nothing anywhere clears it, so joining is recorded and leaving never is.
  It named 94 players for a roster of 84. That is not a bug to fix — never
  clearing is what stops an empty roster snapshot from erasing the alliance —
  but it makes the name a lie, and a new query that trusts it inherits every
  departure since the beginning. The overview (0008 comment) and `member_roster`
  (0102) already join through the roster view; 0139 did not and quietly carried
  ex-members onto the season board until 0146.
- **A query that feeds a screen counting PEOPLE must return one row per
  person.** PostgREST caps responses at 1,000 rows and ignores a larger
  `.limit()`, so a row-per-detail query drops whole entities in silence: the
  building board showed 67 of 84 members and looked complete. Fold the detail
  server-side (`jsonb_object_agg`, `distinct on`) so the row count is the
  entity count — 0144 and 0147 both exist for this. A bigger limit is not a
  fix; it does nothing.
- Timestamps are `timestamptz` UTC. The game week resets Monday 02:00 UTC, and
  that rule is implemented in SQL, Python, and TypeScript — all three consume
  one shared test-vector fixture, so change them together.

## `legacy/` is quarantine

`legacy/v0.4.1/` is the v0.4.1 prototype imported verbatim in a single
`--no-ff` commit. It is excluded from pnpm workspaces, `sys.path`, ruff, mypy,
pytest, biome, and tsc, and CI fails if anything under `services/`, `apps/`, or
`packages/` mentions it.

Promotion is not "move the file". It is: read it, rewrite it in the new
package, commit a sanitized fixture, and add a replay test — one parser per PR
(NFR-009). Track each file's verdict in `docs/legacy-triage.md`.

Never edit files inside `legacy/`. Never rebase or squash the import commit.

## Secrets

Raw PCAPs contain the collector account's UID and session signature. The
Supabase secret key bypasses RLS entirely. `.gitignore` and gitleaks are both
active; do not weaken them, and do not commit anything under a `.pcap`,
`.pcapng`, `*.db`, or `.env` name. Data artifacts live in a sibling directory
outside the repo.

## Testing expectations

- New command parser → normal, null/optional, malformed, and duplicate cases.
- RLS change → pgTAP negative test proving the unauthorized read fails. No
  exceptions (§20.2).
- Scoring change → new version; never overwrite historical scores.

Prefer fixture coverage over line coverage for parsers.

Run everything locally before committing — CI is the backstop, not the loop:

```
pnpm check && pnpm typecheck && pnpm test && pnpm build
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
supabase test db
```

Two traps this repo has already hit:

- **`RAISE EXCEPTION` rolls back everything the function wrote in that call.**
  A throttle that records a failed attempt and then raises erases its own
  counter. Return instead when the write has to survive.
- **Changing a column means grepping the whole repo**, `supabase/` included.
  Checking only `apps/` and `services/` left a pgTAP file pointing at columns
  that had moved.

## Judging a command before promoting it

A UID in the payload is not enough. `docs/runbooks/capture-sweep.md` records
each verdict and the evidence behind it, including three commands that were
rejected after their fields turned out to mean something else.

A verdict is not a promotion. `al.battle.rank.info` was marked "promote" and
never was, so `contribution_type='alliance_battle'` has no writer and the
dashboard column it feeds is permanently empty. If you mark something for
promotion, either do it or say plainly that it is outstanding.
