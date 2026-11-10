# Feasibility: sending `world.get.new` ourselves (active map sweep)

Date: 2026-11-10. Question from the operator: instead of panning the BlueStacks
client to refresh the map, can the collector send the map viewport request on
the wire, every 8 h? Scope: `world.get.new` only, under ADR-0002 (collector
account, read-only, human pace, kill switch).

This is a feasibility study, not an implementation. It reaches a go/no-go and
stops. No game protections were reverse-engineered: the findings come from the
repo's own capture decoder reading pcaps the collector already recorded.

## Method

`scratchpad/sig_study.py` reads pcaps with `protocol/pcapng.py` (the same TCP
reassembler and SmartFox frame decoder the collector uses) and prints shapes,
counts and equality relations only — a secret is shown as 6 hex chars of its
sha256, never its value. Sources: today's live `cap_*.pcapng`, and
`C:\DW_data\581.pcapng` (a 10 MB October session with 275 outbound requests).

## Findings

1. **`world.get.new` carries no signature.** In the 581 capture, 268 of 268
   `world.get.new` requests were sent with no `_sig` field. Its request is
   eight plain integers:
   `{_id, worldId, type, x, y, timeStamp, serverId, viewLvl}`.
   The response is the viewport we already decode (`points`, `maxAreaSize`, …).
   So the signature problem raised in the earlier chat does **not** apply to
   this command.

2. **`_sig` exists but only on some commands.** In a small live capture, 2 of 2
   extension requests carried a `_sig`: 44-char base64 = 32 bytes, one distinct
   value per request (consistent with HMAC-SHA256 over the payload). It is
   per-request, not per-session. `world.get.new`, `al.help.all`,
   `get.user.info.multi`, `mori.note.draw`, `client.perf` were all sent
   without it. Which commands require `_sig` is not yet catalogued; the map
   does not need one, and that is what this study turned on.

3. **The transport is understood.** Outbound frames are SmartFox action id 13
   (extension request) wrapped in the `{a,c,p}` envelope the decoder already
   parses; id 29 is a system keepalive. The repo decodes this today; encoding
   the same shape is the mirror image, not new protocol work.

4. **The real blocker is the session, not the signature.** A request has to
   ride an authenticated SmartFox TCP session to 8680. Two ways:
   - **Piggyback the client's live session.** We do not hold the socket; the
     game client does. Injecting a frame into its TCP stream from outside is
     not reliable. Rejected.
   - **Open our own session** with the login handshake (`account.login.new` /
     `login.other`). The repo has never stored or reproduced that handshake,
     and its credential fields are deliberately masked in fixtures. This is the
     unknown that decides the project.

## Verdict: CONDITIONAL GO, gated on the login handshake alone

The map viewport itself is cheap: no signature, a known request shape, a
decoder that already round-trips the frame format. If a login session can be
established for the collector account, an 8-hour active sweep is a few days of
work — an encoder, a session client, pacing and the kill switch from ADR-0002,
a `world.get.new` request per viewport tile across the grid.

If the login handshake cannot be reproduced, the ADR's own fallback stands:
extend `dw-ui-worker` (the ADB sweep), which needs no session of its own.

## Next step (one spike, before any build)

Study the login handshake from a capture of the collector account connecting:
the frame sequence from TCP connect through the first authenticated request,
which fields are credential vs version vs nonce, and whether the server accepts
a second session for an account already connected. That spike is pure capture
reading, like this one. It does not involve the client's native code, and it is
where the go/no-go actually resolves. Everything downstream is ordinary work.

## What is NOT in scope

Reproducing any command's `_sig` is explicitly out of scope: the map does not
need it, and deriving an anti-automation signature is both the hard part and the
part that most looks like a bot to the server. If a future command needs a
signed request, that is its own decision with its own ADR, not this one.
