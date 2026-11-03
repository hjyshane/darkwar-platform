# ADR-0002: The collector account may send read-only requests, at human pace

- Status: accepted
- Date: 2026-11-04
- Supersedes spec ADR-005 ("직접 packet injection 금지") and the "수집기는 수동
  스니퍼" wording in `docs/runbooks/continuous-collection.md`

## Context

Collection has been passive: a person (or `dw-ui-worker`) opens a game screen,
the client asks, and we decode the answer. That costs two things.

- Finding out which request produces which response means opening screens by
  hand, one alliance at a time.
- The collector account has to be connected and started by a person. A cloud
  machine that could keep it logged in all day does not help while every
  request has to originate from a person's tap.

The map is the existing proof that requests need not come from the screen of
the account's own server: the journal holds viewports for servers 577-588 from
an account that never left 580 (`season-map-capture.md`).

## Decision

The collector may send requests to the game server, under every one of these
conditions.

1. **Collector account only.** Requests are sent only on a session whose UID is
   on an explicit allowlist of collector accounts. The main account is never
   sent to, and `FR-COL-010` (no kill or restart of the main account's process
   or ADB serial) stands unchanged.
2. **Read-only commands only.** A command is sendable only if it is on a
   committed allowlist of lookups (rankings, rosters, profiles, map
   viewports). Anything that changes game state — moves, attacks, spending,
   purchases, chat, mail — is not on it and cannot be added by a setting.
3. **Human pace.** A minimum interval with jitter, an hourly and a daily cap,
   exponential backoff on failure, and an automatic stop after consecutive
   unanswered requests. The numbers live in code and may be lowered by
   configuration, never raised past the code's ceiling.
4. **Named, not free-form.** Triggers (a dashboard click, a schedule) name an
   allowlist key. They never carry a payload.
5. **Kill switch.** A file and a dashboard toggle stop sending at once; sending
   is off until someone turns it on.
6. **Observing stays the default.** `dw-capture` remains a passive sniffer and
   never writes to the wire. Sending lives in its own package and process.

The collector may also run unattended in the cloud, and may relaunch the game
client when a packet-level signal says it needs it (a version change, a
maintenance or kick push, a stalled link). Relaunches back off and are counted;
repeated failure stops the loop and raises `data_stalled`.

The earlier "Development is Windows-only. No WSL." decision in `CLAUDE.md` is
withdrawn: the collector runs on a Windows PC, a Mac with an iPhone, or a cloud
host, and what matters is that capture, the client tooling and the supervisor
share one process tree.

## Consequences

- Direct sending needs an encoder and a login the repo does not have, and
  outbound frames were never stored. Before any of it is built, request
  capture and a command catalog come first, then a feasibility check on the
  login handshake. If the handshake cannot be reproduced, this ADR still
  stands but the work turns to extending `dw-ui-worker`.
- The risk is the account, not the data: the game may rate-limit or ban an
  account that behaves like a bot. The collector account is the one thing we
  are willing to lose; the pacing and stop rules exist to make that unlikely.
- 24-hour operation can run into idle logouts or the game's terms
  (`continuous-collection.md`, "남은 위험").
