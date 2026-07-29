# ADR-0001: `game_uid` is unique across the server group and encodes the home server

- Status: accepted
- Date: 2026-07-28
- Supersedes open decision **D-1** in `docs/bootstrap-plan.md`

## Context

Migration 0002 had to choose an identity for players before any real data
was available. Two candidates:

1. `game_uid` globally unique across the 577-584 group
2. `(server_id, game_uid)` composite

The bootstrap plan reasoned toward (1) — `server.rank` returns cross-server
rankings in one response, and server merges make `players.server_id`
mutable, which would split a merged player into two identities under (2) —
but recorded it as unverified.

## Decision

`players.game_uid` is `bigint not null unique`, globally across the group.
`server_id` is a mutable attribute of the player, not part of their key.

## Evidence

The v0.4.1 SQLite (191 players) and every promoted parser agree:

- No uid appears under more than one server.
- The uid **embeds its home server as the trailing six digits**:
  `1327205044000578` is a player on 578, `1135062125000580` on 580.
- `server.rank` returns 150 players from all eight servers in one response,
  each carrying its own `serverId`, matching the uid suffix.

So the game itself treats the uid as group-global and self-describing.

## Consequences

- A player's home server is derivable from the uid alone. Parsers use this
  as the fallback when a response omits `serverId` (`al.rank` nulls,
  `get.user.info.multi`, `server.rank`) instead of attributing the row to
  the observing server, which would be wrong for cross-server responses.
- Snapshot rows keep `server_id` as the *subject's* server and record
  provenance separately in `collector_id` / `collected_from_server_id`.
- Fixture sanitization must preserve the server suffix, or fixtures stop
  representing the real identity space. `sanitize._fake_uid` hashes the uid
  body and keeps the last six digits.
- A merge that moves a player between servers changes an attribute, not an
  identity; no rows are orphaned.

## If this turns out wrong

Adding `server_id` to the unique constraint is one migration. The reverse —
discovering after months of history that a composite key split merged
players — is not cheap, which is why the cheap-to-reverse side was chosen
before the evidence arrived.
