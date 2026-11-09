# Alliance page — design

Date: 2026-11-08. Status: draft for builder check.
Depends on: `2026-11-08-console-foundation-design.md` for phase B.

## Intent

The alliance page (`features/alliance/AlliancePage.tsx`) has seven tabs of
depth but no first-screen reading, no movement feed, and none of the
alliance's own words (intro, announcement, join rules) even though
`get.al.info` delivers them and they sit unused in `alliance_snapshots.raw`.
The competitor shows a header with verdict-style context, a "recent moves"
panel naming where each player came from or went to, and the intro text
with an allies list. We add those three things from data already captured,
in the console system.

## Goals

- First screenful: rank among the server's alliances with lead or gap,
  power, members against the cap, how many we have actually observed,
  join rule and minimums, language, and how fresh the roster read is.
- The alliance's intro and announcement text, with allied alliances pulled
  out as links when the text names them.
- A movement feed: who joined from where, who left to where, with their
  power at the time, for every player we observe anywhere.

## Non-goals

- A cluster or server-range filter. The group is eight fixed servers.
- Rosters for alliances nobody opened in the client. We show what we
  observed and say so.
- Changing the tab set beyond adding one.

## Anti-goals

- Trusting `players.current_alliance_id` for membership. It is last-known
  and never cleared (CLAUDE.md). Membership for *our* alliance comes from
  `alliance_roster_latest`; movement comes from observed changes, below.
- A feed that silently drops moves because a query returned a row per
  detail. One row per move, built server-side.

## What the page shows

### Header (phase B)

Identity: tag, name, server, leader, founded date if the payload carries
one. `Led`s: roster freshness (warn past 48h), capture completeness (bad
when the newest roster capture was cut short, which the page already
detects).

`Verdict`: "#{rank} of {n} alliances on {server}, {lead} ahead of
[{tag}]." or "{gap} behind [{tag}]." Then, when known: "Joins need
approval · {power} and HQ {level} minimum." Composed by
`composeAllianceVerdict(facts)` in `features/alliance/verdict.ts`, fixture
tested, clauses dropped when data is missing.

`CellGrid`: Power (context: 7d delta from `alliance_power_history`), Rank
on server, Members `n/max` (context: observed count), Join rule, Minimums,
Language.

### Intro panel (phase B)

Intro text and, for members of the alliance viewing their own alliance,
the announcement text. Markup is plain text with line breaks preserved.
When a line matches the pattern `<server> <TAG> [<TAG> ...]` (the
screenshots show `565 RBRN / 570 SYNN SYN2 RYSE / 571 ZBM`), each tag that
resolves to a known alliance on that server becomes a link; unknown tags
stay text. Parsing lives in `features/alliance/allies.ts` as a pure
function with fixtures for the slash-separated, newline-separated and
no-match cases. Never guess a match across servers.

### Recent moves on Overview, full feed on a new Moves tab

Each row: player (link), direction in or out, the other alliance as
`[TAG] on {server}` or "no alliance", power at the time, when observed.
Overview shows the newest five; the Moves tab shows the feed with in/out
filter and a 90-day window, paged by the existing `Pager`.

## Data work (phase A)

### Promote alliance info fields

`get.al.info` carries `intro`, `announce`, `language`, `joinApproval`,
`powerRestrictionN`, `castleRestrictionN`, `country`, `maxMember`,
`recruitTotal` (fixture `protocol-fixtures/decoded/get.al.info/love_580_v1.json`).
The normalizer `normalize/get_al_info.py` lifts only name, code, power,
member count, leader. Promote, per the schema rule (a key observed
consistently moves to a typed column):

- `alliance_snapshots`: `intro text`, `announce text`, `language text`,
  `join_approval boolean`, `min_power bigint`, `min_hq int`, `max_members
  int`, `country text`.
- Migration backfills from `raw` for existing rows, so history is not lost.
- A view `alliance_info_latest` (one row per alliance, newest snapshot) for
  the page.
- Builder verifies first that `sanitize.py`'s redaction of `announce` and
  `intro` applies only to committed fixtures, not to what the collector
  stores. If it redacts at storage, this feature cannot ship the text and
  the spec is reduced to join rules and language; say so in the PR.

Read gates: `intro`, join rule, minimums, language, members cap readable by
any signed-in role that can read `alliances` today. `announce` readable
only by members of *that* alliance and admins, decided per row: the
viewer has a row in `alliance_memberships` for `auth.uid()` and
`s.alliance_id`. Not by `current_app_role()`, which is per-request from
the `x-alliance-id` header: since 0192/0193 a user can belong to several
own alliances, and a role-based gate would hand alliance A's member
alliance B's announcement when the header says A. pgTAP negative tests: a
community account, and a member of own alliance A viewing own alliance B,
both get null `announce`.

Semantics to confirm before the verdict sentence is written:
`joinApproval` is an integer in the payload (fixture ADET has
`joinApproval: 1, recruitTotal: 1`) and the legacy code printed it raw.
Builder checks that alliance in the client to learn whether `1` is "needs
approval" or "open join" and records the answer as a comment on the
column. Until confirmed, the cell shows the raw value with the label
"Join (raw)" rather than a guessed sentence.

`language` is a localization key (`391083` is Traditional Chinese in the
client's dictionary), `country` an ISO code. Both resolve through a TS
constant in `features/alliance/codes.ts` built from the client
localization table, English and Korean columns, with a fixture test; the
column stores the raw key so a new key still displays as its code instead
of failing.

Collector change is Python under `services/`: commit it from the main
checkout, not this worktree (repo memory: committing collector code from a
worktree silently drops it).

### Movement feed

Source: `player_snapshots` (0003), which carries `alliance_external_id`,
`power`, `server_id` and `captured_at` per observation and is readable by
every signed-in role. That is the only source in this project. No union
with `alliance_member_snapshots`: its grants are officer-or-own and a
union would force a definer view that leaks roster reads. Coverage is
therefore "players who appear on any board or profile we capture", which
the tab's caveat states.

Server side: an RPC `alliance_moves(alliance_id, since)` returning one row
per move: `player_game_uid`, `direction` (`in`, `out`, `relocated`),
`other_alliance_id`, `other_alliance_tag`, `other_server_id`, `power_at`,
`observed_at`. A move is the first observation where the player's alliance
differs from their previous observation; `other_*` is null when the
previous or next alliance is unknown or none. `alliances` is unique on
`(server_id, external_id)`, so a relocated alliance is a second row: when
the previous and next alliance share `external_id` but differ in
`server_id`, the direction is `relocated` and it is listed under the
alliance's new row, not as a leave plus a join. Index leads with
`server_id` as the schema rule requires. pgTAP: a join, a leave, a
server-crossing join to a different alliance, a relocation, and a player
seen once (no move).

Who may see the feed (user decision 2026-11-08): for an own alliance, its
own members (an `alliance_memberships` row for `auth.uid()` and that
alliance), officers and admins; community accounts and members of other
own alliances get no rows. For any other alliance, every signed-in role,
since community already reads those rosters (0283). The RPC is security
invoker; the per-alliance branch lives inside it so the page has no role
logic. 0067's admin Departed setting stays as it is. pgTAP negatives: a
community account calling for an own alliance gets zero rows; a member of
own alliance A calling for own alliance B gets zero rows; the same
community account calling for a non-own alliance gets rows.

Freshness caveat rendered on the tab: "Moves are detected when we next
observe the player; a player nobody has seen since leaving shows no move."

## Constraints

- Migration number from `origin/main` at push; run
  `scripts/check-migration-order.sh`.
- RLS change implies pgTAP negative tests, no exceptions.
- Hosted traps from repo memory: grant `select` on new views explicitly
  to `authenticated` and the community role; revoke from `anon`; new
  functions get `revoke execute from anon`.
- Language: English UI, as the site is today (user decision 2026-11-08).
  The language and country code tables carry an English name; a Korean
  column is kept in the constant because the client dictionary has it,
  but nothing renders it yet.

## Left to the builder

- Whether the allies parser also handles `TAG@server` and `s570 SYNN`
  forms; include them if a fixture from a real intro shows them.
- Page size for the Moves tab.
- Whether `country` is worth a cell or stays in the intro panel.

## Decided by Claude, user can override

- Announcement text is members-only; intro is for all signed-in roles.
  Mirrors what the game shows to outsiders.
- The feed covers every player we observe, not only members of our own
  alliance, because the same query answers "who is [CLaw] recruiting".
