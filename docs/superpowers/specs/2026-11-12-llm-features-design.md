# LLM features in the product — design

Date: 2026-11-12. Status: **draft, nothing built.** Three decisions at the end are the owner's.

## Intent

The platform has no LLM anywhere today (checked: no `anthropic`/`openai` reference outside this file). The
question is where a model earns its place in a system whose value is *trustworthy numbers*. The answer
this spec argues for: **a model may write about the numbers; it may never produce, change, or decide them.**
First slice: a weekly alliance digest drafted for officers to edit and post.

## Boundaries (these are the design; the slices are details)

1. **Not in the data path.** Nothing under capture, normalize, sync, scoring, or `build_rank_period` calls a
   model. Idempotency keys, parser versions and scoring versions stay deterministic (CLAUDE.md "Observation seam",
   "Scoring change → new version").
2. **Facts in, prose out.** The model never queries. A SQL function returns a bounded `facts` JSON; the model
   receives only that. It cannot reach other tables, and a prompt injection in a player name can at worst
   distort prose, not read data.
3. **Drafts, not actions.** Output lands in `llm_drafts` as `status = draft`. A human edits and approves; posting
   to Discord stays a human click. No tool use, no write-back, no path from model output to a state change
   (ADR-0003's allowlist is about the collector account and does not extend here).
4. **Grounded, checkably.** A deterministic validator rejects a draft containing a number, rank, or name that is
   not in `facts`. This is cheap, runs in CI against recorded responses, and is the thing that makes "LLM wrote
   it" safe enough to ship.
5. **Officer-only, via the caller's JWT.** The function runs as the officer, so RLS decides what facts they can
   see (rank rebuilds are already officer-only: rank-report.md, 0112). Members never trigger calls.
6. **Provenance on every draft.** `model`, `prompt_version`, `facts_hash`, `created_by`. A prompt change is a
   new version; old drafts are never rewritten (same rule as scores).
7. **Capped and killable.** A per-day call cap and a kill switch (a settings row), like the collector's.

## Slices

| | What | Risk | Verdict |
|---|---|---|---|
| **A** | Weekly digest draft: rank movement, promotions/demotions *as computed by `rank_period_latest`*, roster changes, migration moves, notable season-board changes → a short post in ko or en | Low: output is edited before use | **First** |
| B | "Why this tier?" per member | The explanation is deterministic (the score components are known); a template does it better than a model. Build `packages/scoring-explain` first, add a model only if prose is wanted | Defer |
| C | Natural-language questions in the dashboard | Higher: needs a fixed menu of read-only RPCs as tools, per-user rate limits, answer grounding | After A proves the plumbing |
| D | Triage of unknown commands / new `raw` keys | A development-time job, and the data lives on the Windows machine | Not a product feature; see `scheduled-routines.md` |

## Slice A in detail

- **Facts:** `llm_digest_facts(period_start, alliance_id)` — SQL, `security invoker`, returns jsonb with
  `rank_period_latest` movement, departures/arrivals from `alliance_roster_latest` (never
  `players.current_alliance_id`), `player_server_moves` for the window, one row per person. Row counts are
  bounded server-side (no PostgREST 1,000-row surprise).
- **Where it runs:** a Supabase Edge Function `llm-digest` (see decision 2). It forwards the officer's JWT to the
  facts function, calls the model, runs the validator, inserts into `llm_drafts`.
- **Table:** `llm_drafts(id, kind, scope jsonb, facts jsonb, facts_hash, prompt_version, model, output,
  status in (draft, approved, discarded), created_by, approved_by, created_at)`. Insert-only for the model path;
  status changes by officers. RLS: officers read/write; **a pgTAP negative test proves a member's read fails** (§20.2).
- **UI:** Admin → Digest: generate, see facts beside the draft, edit, approve, copy. No auto-post.
- **Model:** a current Sonnet-class model for drafting; the id and prompt are constants in one file so a change is a
  reviewed diff. Cost is a few thousand tokens a week.
- **Tests:** golden facts fixtures + **recorded** model responses (CI makes no network call); validator cases
  (invented number, renamed player, missing section); RLS negative test; prompt-version bump test.

## Non-goals

- Any model call in ingest, normalization, scoring, or the collector.
- Model-chosen promotions/demotions, or model-written SQL.
- Auto-posting to Discord. The bot "reads nothing" (discord-bot.md) and keeps that property.
- Member-facing generation in the first slice.

## Decisions for the owner

1. **First slice** — A (digest), or start from C (questions) / B (explanations).
2. **Where it runs** — Supabase Edge Function (inherits the officer's JWT so RLS applies; `supabase/functions/`
   does not exist yet and would be created for this) or a Cloudflare Worker like the bot (separate secret store,
   but you must re-implement auth and facts access).
3. **Data egress** — facts contain game character names, power and contribution numbers of group members, sent to
   an external model API. Acceptable? And custody of the API key (a Supabase secret, never in the repo or a
   `VITE_` variable; never reaching the browser).
