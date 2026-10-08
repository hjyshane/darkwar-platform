# Event times read from the game (0249)

The siege, Frankie and Black Gold are scheduled by the alliance, and the game tells every
logged-in member the pick. The collector stores it (`alliance_event_times`) and a trigger puts it
on that alliance's schedule board as a `captured` entry, so the calendar and the Discord reminders
need nobody to type it.

| Event | Command | What is read |
|---|---|---|
| Zombie Siege | `monster.siege.activity.info` | `siegeST` |
| Frankie (Bio-Mutant boss) | `get.alliance.boss.activity.info.new` | `battleStartTime` and `battle2StartTime` |
| Black Gold, teams A and B | `dragon.activity.info` | `teamArr[].timeInfo` (`battleOpenTime`, `endTime`) |

All times are stored in UTC. **Server time is UTC-2**, the clock the members read: a siege at
11:30 server time is 13:30 UTC. Checked on 2026-10-08 against what the alliance had set (siege
11:30; Frankie 00:30 and 13:00; Black Gold B 10:00 and A 19:00 on 10/11).

## Which alliance

Black Gold's response names both sides and the parser takes ours (the one in every matchup). The
siege and Frankie responses name nobody, so the database uses the alliance of the account that
logged in within the ten minutes before (its roster row). **The collector has to be logged in as a
member of the alliance whose board should get the entry**; after the move to ACE, log the
collector's account in as ACE. If no login is found the row is stored and no entry is made, because
a siege on the wrong alliance's board is worse than none.

## What lands on the board

- Boards `Zombie Siege`, `Frankie` and `Black Gold` are created per alliance, with no Discord
  channel. **Nothing is sent until an officer routes a board and adds a reminder**: a reminder is
  a Discord message, and that stays a decision for `schedule.manage`.
- An entry is keyed by event, slot and server day. The game changing the time the same day edits
  the entry; an officer's own title, text and board are kept. A pick that moves to another day
  while the old one is still ahead replaces the entry.
- Entries older than 14 days are not added.

## Not covered

- The Survival Preparedness slots and the Alliance Duel days are scheduled by the game, not the
  alliance: they are in the event calendar (`init.activity`) and in the game's own data
  (`hero.event.info.get`, `get.hero.event.calendar`, the `score` datatable).
- A second alliance's times (ACE) need that alliance's account logged in; nothing else changes.
