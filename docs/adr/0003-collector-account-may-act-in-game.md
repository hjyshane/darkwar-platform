# ADR-0003: The collector account may act in the game, starting with alliance help

- Status: accepted
- Date: 2026-11-11
- Amends ADR-0002: the "read-only commands only" condition (its point 2) is
  waived. The other conditions stand as defaults.

## Context

ADR-0002 let the collector account run unattended in the cloud and send
requests, but only lookups. The thing the owner wants most from a cloud account
that is always logged in is not a lookup: when an alliance member asks for help
(a heal, a build, a research), answer at once. A person who opens the game by
hand does this in seconds; a collector that waits for its next sweep does it
minutes late, which is most of the value lost.

Daily rewards and other chores the owner is happy to keep doing by hand, so
they are not part of this decision.

## Decision

**The collector account may perform in-game actions that change game state.**
What it may do is a committed allowlist of named actions, not a free-form
payload and not a setting. The list is expected to change: adding an action is
a reviewed change to the list and to the table below, with no new ADR needed.

| Action | Added | How it is done | Trigger |
|---|---|---|---|
| `alliance_help` | 2026-11-11 | Screen automation (`ui_worker` routine on the cloud emulator) | A help request is pending (`push.al.help.new`, or a periodic check) |
| `alliance_tech_donate` | 2026-11-11 | Screen automation; resource donation only, never the gem option | Every ~250 min, when attempts have refilled |
| `alliance_gift_claim` | 2026-11-11 | Screen automation; claim only, never delete | Once a day (rewards expire after 24 h) |
| `warehouse_gift_claim` | 2026-11-11 | Screen automation; only when the treasure-chest icon is on the warehouse | Whenever the chest is showing |
| `adventure_camp_claim` | 2026-11-11 | Screen automation; Claim only, never Combat | When the camp's chest shows (8 h cap) |
| `survivor_act_use` | 2026-11-11 | Screen automation; Total Mobilization, Resource Allocation, Double Efficiency, Survivor Celebration. These cost currency and Total Mobilization lowers survivor mood by 10; the owner accepted that. Survivor Celebration and Total Mobilization are never active together. | When a card is off cooldown |

Planned, not yet allowed: `radio_station_recruit` (only when the button says
Free, never the ticket or gem button) and the radio station dispatch mission.
Healing Potion and Emergency Project (also in Survivor's Act) are not on the
list until the owner asks for them.

The screens, coordinates and the responses that verify each step are in
`docs/runbooks/cloud-actions.md`.

Kept from ADR-0002 as defaults, because they protect the account and cost
nothing to keep. Each is a number or a switch in code that the owner can change:

1. **Collector account only.** UID allowlist and the adb target guard. The main
   account is never acted on, and `FR-COL-010` stands unchanged.
2. **Named actions.** A trigger names an allowlist key; it never carries a
   payload.
3. **Human pace.** A random delay before acting, an hourly cap, backoff on
   failure, an automatic stop after consecutive unverified attempts.
4. **A step is verified, not assumed.** A tap counts only if the response it
   should produce arrives; otherwise the run stops (`ui_worker/runner.py`).
5. **Kill switch and pause.** A file stops all actions at once. While the owner
   is logged in by hand the collector is paused: no taps, no restarts.
6. **Observing stays the default.** `dw-capture` remains a passive sniffer.

## Consequences

- The risk is the account. Acting on a schedule a person would not keep can be
  rate-limited or banned. The collector account is the one thing the owner is
  willing to lose; pace and stop rules make that less likely, not impossible.
- A restart of the game client kicks whoever else holds the session. The
  watchdog must therefore not relaunch while the owner is playing; see the pause
  state in `docs/runbooks/cloud-unattended.md`.
- Reacting to a push needs a path that does not wait for the 60 s capture chunk.
  That path reads the same frames and only watches for the triggers on the list.
- The allowlist is code. A reviewer reading a pull request sees every action the
  account can take.
