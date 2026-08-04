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
(§18.4), the deploy pipeline (§21.1), and Playwright.

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
