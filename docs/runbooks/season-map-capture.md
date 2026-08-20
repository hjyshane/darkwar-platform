# Season 3 map — the capture that has to come first

The season situation board wants five things: the map, our tower, our territory,
the season score, and per-member building progress (thermal lab / greenhouse
especially). **None of them can be built from confirmed data today.**

Of the 17 commands the sweep has judged so far — `server.rank`,
`get.new.user.info`, `al.rank`, and the rest in `capture-sweep.md` — **not one is
map or season related.** Spec §5.3 lists the gap explicitly:

| item | status |
|---|---|
| 시즌 지도 viewport object payload | 미확정 |
| 시즌 건물 production fields | 미확정 |
| 개인별 시즌 기여 귀속 가능 여부 | 미확정 |

Spec §14.3 states the position this runbook exists to act on: it is technically
inferable that the client must receive object data in order to draw the map, but
**the actual fields must be verified by PCAP.** Building the tables first means
inventing columns, and an invented column ships a wrong number to 94 people.

This is a capture plan, not a schema. Its output is a table of what actually
arrives.

## The three questions

1. **Can building level be fetched?** Spec §14.2 plans for a Discovery Scan
   collecting object ID, type, coordinates, owner, level and state. That is a
   plan. Whether the payload carries `level` is what `03_map_pan_scan` answers.
2. **Can our members be located on the map?** Two separate unknowns: whether
   coordinates arrive at all, and whether an `owner` field arrives that can be
   joined to a player we already know. The second one is §5.3's attribution row.
3. **Can we fetch the whole map once and then apply only changes?** This is
   §14.2's Discovery/Detail split, and it is feasible *by design* — but only if
   the viewport payload carries a **stable object ID**. Without one there is no
   diff, only a fresh snapshot every pass. That is a yes/no the PCAP settles.

A fourth thing worth saying plainly: this is not a server API anybody can poll.
The collector has to physically pan the map, so a tile is only as fresh as the
last pass over it.

## Before capturing

Wireshark alongside the collector, as `capture-sweep.md` argues at length: a pcap
preserves bytes that failed to decode, and a decoded journal cannot. Three
parsers' worth of fixtures once came out of a single pcap.

- Capture **filter** (not display filter): `tcp port 8680`
- Save as **pcapng** — the reader takes nothing else
- Save **outside the repo**, e.g. `C:/DW_data/season3/`

**Raw PCAPs contain the collector account's UID and session signature.** They are
gitignored and gitleaks is active. Do not move one into the repo to "look at it
quickly", and do not attach one to an issue.

## The six captures

From spec §26.1. Take them as separate files — one action per file is what makes
a negative result meaningful, because "the command is absent from this file" only
means something when you know exactly what was done while it recorded.

| file | do this in game | answers |
|---|---|---|
| `01_season_login.pcapng` | log in, land on the season screen, touch nothing | what the season handshake sends unprompted |
| `02_season_overview_tabs.pcapng` | open every season tab once, slowly | where the season score / ranking board comes from |
| `03_map_pan_scan.pcapng` | pan the map several screens in one direction, then back over the same ground | **questions 1, 2 and 3** — object payload, coordinates, owner, level, and whether IDs repeat |
| `04_open_one_season_building.pcapng` | open one thermal lab, then one greenhouse | the per-building detail fields, production among them |
| `05_collect_or_contribute.pcapng` | collect from, or contribute to, one building | whether contribution is attributed to a person |
| `06_alliance_season_contribution.pcapng` | open the alliance season contribution screen | the aggregate our board would show |

`03` is the important one, and **panning back over ground already covered is the
part people skip.** Whether the same tile returns the same object IDs is exactly
what decides question 3, and a one-way pan cannot show it.

## Season 3 is open — capture it directly

Season 3 went live. That is the event `capture-backlog.md` item 6 was waiting
for, and it is why §14 has been sitting closed.

An earlier version of this runbook planned a detour: take the structure off the
season 2 map, then re-confirm the values on season 3 day one. **That detour is
gone.** Spec §14.1's per-season configuration — active event IDs, building type
IDs, resource types, map bounds and zoom, payload field mapping — now all come
out of one set of captures, and every value in them is a season 3 value.

What replaces it is the opposite timing problem, and it is worth being exact
about.

**An early season board is populated by almost nothing.** The season 2 plan
leaned on a late, full board: a field missing from a full board is missing
because the server does not send it. Reverse the timing and the inference
reverses with it. On day one a field that is absent, zero, or an empty array may
mean the server never sends it — or it may mean nobody has built, produced, or
contributed yet. **A capture taken now cannot tell those two apart.**

That does not make the capture less urgent. It decides which questions it can
close.

| an early capture settles this | this needs a second pass later in the season |
|---|---|
| the command names | whether production / stored fields ever carry a value |
| viewport payload field names and types | whether contribution is attributed per person (`05`, `06`) |
| whether object IDs are stable across two passes | whether the standings list pages (`09`) |
| whether coordinates arrive | what a built-up building's `level` and `state` look like |
| whether an `owner` field arrives and joins to `players` | the three centres once unlocked (`08`) |

So: **take all nine now, and take `04`, `05`, `06` and `09` again once the map
has filled in.** The second pass is cheap — the pcaps are small and the reading
is one command each — and it is the only thing that turns "absent" into "absent
because the server does not send it".

Record the in-season date on every file. A field table assembled from two passes
is only readable if each column says which pass it came from.

Three additions to the file list above, all about making a payload *judgeable*
rather than merely present:

| file | do this | why |
|---|---|---|
| `07_two_buildings_same_type.pcapng` | open two **different** buildings of the same type, then re-open the **first** one | separates fields that identify an object from fields that describe its type — and re-opening proves the ID is stable, the same way the double pan does for the viewport |
| `08_alliance_centres.pcapng` | open all three alliance centres in order | whether a centre is its own object kind or a season building with a flag, and whether the locked ones report their unlock condition |
| `09_season_rankings.pcapng` | open the season standings and **scroll to the bottom** | the score board the tab would show, and whether it pages |

`09` is the one an early capture serves worst, and it should still be taken.
**Scroll it.** The sweep already found `rank.get.by.range`, which means ranked
lists on this server are fetched in ranges — whether the season board does the
same only shows once the list is pushed past its first page, and on day one it
may not reach a second page at all. If it does not, that is not an answer; it is
the reason `09` is on the re-capture list.

For the player-owned season building, open **one owned by a member we already
have in `players`, and one owned by somebody outside the alliance.** That single
contrast is what decides question 2: an `owner` field is only useful if it joins
to a player we know, and a capture containing only strangers cannot show that it
does.

### Keep a plain log beside the pcaps

One line per file: what was done, and roughly when. A negative result — "the
command is absent from this file" — only means something when it is known what
was happening while it recorded. `capture-sweep.md` has one entry that had to be
retracted for exactly this reason: the handover claimed a capture contained mail
reception, and it contained none.

## Reading them

`--discover-only` records the shape of unknown commands into
`schema_observations` and ingests nothing (FR-COL-008). That is the correct mode
here: nothing is understood yet, so nothing should be written as if it were.

```bash
uv run dw-collector scan-capture --pcap C:/DW_data/season3/03_map_pan_scan.pcapng --discover-only
```

It prints `ingested= discovered= rejected= commands=`. Then:

```bash
uv run dw-collector journal-summary
```

which lists observations by command. **Any name that is not already in
`capture-sweep.md` is new**, and the season commands will be among them.

Forward slashes in paths — Git Bash eats backslashes and the command silently
does the wrong thing.

## What comes back to me

The command names and counts from `journal-summary`, per file. From that plus the
recorded shapes I can write the field table — what actually arrives, with types
and how consistently each field is present — and only then is there enough to
design a schema.

The `get.new.user.info` verdict is the standard to match: 97 distinct players,
six fields present in 97/97, and 20/20 samples where the components summed
exactly to the total. That is what "confirmed" means here. A field seen once is
not a field.

## Two traps already known

- **Coverage is not the same as absence** (§14.5). A member not visible in fog is
  unknown, not elsewhere. The board must show coverage separately from counts,
  or an unexplored quarter of the map reads as an empty one.
- **Production has three kinds of truth** (§14.4): `observed` from the server,
  `calculated` from two observations, `estimated` from a template. The UI has to
  distinguish them. A number nobody measured must not sit in the same column as
  one the server sent.

## What the first capture returned (2026-08-20)

One combined file, `season_tab_map_building.pcapng` (6.3 MB), covering the season
tab, a map pan, and some object opens. Not the nine separate files this runbook
asks for — so **a command absent from it means nothing**, because there is no
record of whether the action that would produce it was performed. What is
*present* still counts.

```
ingested=0 discovered=127 rejected=0 commands=25
```

Zero rejected: the decoder handled every inbound frame in the file.

### The map is `world.get.new`

28 viewport responses. Each carries `x`, `y`, `viewLvl`, `maxAreaSize` (1000) and
`points` — up to 657 entries, 7678 in total, **1189 of them distinct**.

A point is a string of the form `46b:<base64>`. The key is the constant `46b` in
all 7678. The base64 decodes to **protobuf**; there is no `.proto`, but the wire
format is enough to read it.

| field | meaning | evidence |
|---|---|---|
| `f1` | **coordinate**, packed as `x * 1000 + y` | max 610381 → (610, 381) against `maxAreaSize` 1000 |
| `f2` | **object type** | 10 values: 3, 4, 6, 7, 11, 13, 14, 15, 21, 22 |
| `f102`, `f103` | server id | 580 in 1189/1189 |

### The three questions, answered

**1. Can building level be fetched? — yes.** `world.get.detail.new` is plain JSON
and returns an `alBuilding` object carrying `level`, `buildId`, `durability`,
`status`, `buildSpeed`, `calculateScoreSpeed`, `lastBuildTime`, `battleStartTime`,
`allianceId`, `alName`, `alAbbr`, `pointId`.

All three alliance centres were opened — `buildId` 41000, 42000, 43000, each
`level` 1, `durability` 1600000, `buildSpeed` 4.0. `calculateScoreSpeed` differs
per building (2773 / 697 / 0), which is the production rate the board wants. This
is 3/3 of the population, not a field seen once.

**2. Can our members be located on the map? — yes, and without opening anything.**
Of the 24 opened player objects, the map tile's uid matched the detail response's
`uid` in **24/24**. A pan alone yields the uid.

**3. Can we fetch once and apply only changes? — yes.** `pointId` is the join and
it holds both ways: every opened object's `pointId` was present in the map
(27/27), `point == pointId` (27/27), and **no coordinate was ever reported under
two different types (0 of 1189)**. 1189 distinct tiles out of 7678 emissions is
the same fact from the other side: the pans re-covered ground and the tiles came
back identical.

### Object types

| `f2` | tiles | what it is | opened? |
|---|---|---|---|
| 7 | 366 | resource tiles — `f6.6`/`f6.7` amounts, 30 to 20,000,000 | no |
| 6 | 327 | **marches**, not cities | yes, 24 |
| 4 | 179 | unidentified | no |
| 21 | 165 | unidentified | no |
| 3 | 135 | **player cities** — uid, level, alliance tag | no |
| 13 | 6 | unidentified | no |
| 15 | 3 | **alliance buildings** (the three centres) | yes, 3 |
| 14, 22 | 3 each | unidentified | no |
| 11 | 2 | unidentified | no |

**Type 6 is marches and type 3 is cities, and it is worth saying why**, because the
opposite reading is the natural one and it is wrong. Type 6 is what gets opened
when you tap something, so it looks like the city layer. But a single uid appears
at **one** type-3 coordinate and at **many** scattered type-6 coordinates — one
player was at (7,9), (6,15), (592,382), (11,3) and (591,379) at once. A city
cannot be in five places. Type-3 coordinates cluster; type-6 coordinates do not.
87 of the 88 type-6 uids also own a type-3 tile.

The consequence for the schema: **type 6 is transient and must not be stored as
map state.** The durable layer is type 3 (cities), type 15 (buildings) and type 7
(resources).

### Where the season score comes from

| command | returns |
|---|---|
| `get.alliance.season.score.rank` | 89 alliances — `rank`, **`oldRank`**, `score`, `power`, `allianceId`, `serverId`, plus `selfRank` / `selfOldRank` / `selfScore` |
| `desert.force.server.rank` | 149 players — **`uid`**, `force`, `rank`, `allianceId`, `name`. Per-player and uid-keyed |
| `desert.force.self.rank` | own rank only |
| `get.season.group.server.info` | `groupId` and **4** servers, each with a `kingInfo` (uid, name) |
| `season.balance.view.open` | `groupId`, `settleEndTime`, `stage_time` |
| `season.force.reward` | reward stages and claim `state` |
| `get.alliance.resource.store.info` | alliance `crystal` / `electricity` / `money` / `sapphire`, and `storeLogArr` — 20 entries carrying **`uid`**, `cost`, `time`, `type` |

`oldRank` arriving from the server matters: movement does not have to be computed
from a previous snapshot the way `rank_period_movement` does it today.

**The season group is 4 servers, not 8.** The dashboard's server-group assumptions
are built around 577-584; a season group is a different, smaller set, and
`groupId` is its identifier.

### Still not answered

**Per-member season building contribution — the "연맹원만" part of the ask — is
not in this capture.** `alBuilding` is alliance-scoped and has no per-member
breakdown. The closest thing present is `get.alliance.resource.store.info`'s
`storeLogArr`, which is uid-attributed but is a *resource store* log, capped at 20
entries, not building levelup. Whether levelup is attributable per person is still
§5.3's open row, and it needs the two files this capture did not contain:
`05_collect_or_contribute` and `06_alliance_season_contribution`.

Also outstanding:

- **Six of the ten object types were never opened** — 4, 21, 13, 14, 22, 11, and
  more importantly **3**, the city layer. The city fields (uid at `f3.1`, a 17–45
  value at `f3.4` that looks like level, an alliance tag at `f3.14`) are inferred
  from shape and from the uid namespace matching; **no type-3 tile was opened, so
  none of it is confirmed against a detail response.** Open one.
- Coverage: 1189 tiles against a 1000×1000 coordinate space. This pan saw a
  sliver.
- Whether the two rank lists page. 89 and 149 rows arrived in one response each;
  `rank.get` returned 469 rows in one, so large single responses are normal here,
  but neither season list was scrolled to a point that would prove it.

### Two traps found in the data

- **`battleStartTime` is 9223372036854775807** on all three buildings — int64 max
  as a "no battle scheduled" sentinel, not a timestamp. Stored as `timestamptz` it
  becomes a year-292-million date. The same sentinel appears at `f3.18` and
  `f3.23.3` in the protobuf.
- **`buildSpeed` is a float (`4.0`) and `calculateScoreSpeed` an int.** They are
  different quantities; the second is the season score rate and the first is not.

## What is buildable now, and what is not

`CLAUDE.md` puts season and map under "not being built yet" because the fields
would be guesses. For part of this they are no longer guesses, and the entry
should say so per surface rather than as one blanket.

| surface | status |
|---|---|
| season ranking board (alliance) | **built** (0136) — `alliance_season_score_snapshots` + `normalize/season_score_rank.py`. 89 rows round-trip to Supabase, servers 580/584/586/588 |
| season ranking board (player) | **built** (0136) — `player_season_force_snapshots` + `normalize/desert_force_rank.py`. 149 rows round-trip |
| season overview / group | **buildable** — `get.season.group.server.info` plus `season.balance.view.open` for the clock |
| alliance building level & production | **buildable** — `alBuilding`, 3/3 of the population, but only at level 1 and with one of the three not yet producing |
| map: cities, resources, territory | **partly** — coordinate, type, uid and the `pointId` join are confirmed; the *city* payload's own fields are not, because no type-3 tile was opened |
| per-member building levelup | **not buildable** — no per-member attribution observed anywhere |

The two things to capture next, in order:

1. **Open a type-3 tile** (a player city on the season map). One capture confirms
   or kills the city field reading, and it is the difference between a territory
   view built on evidence and one built on a shape guess.
2. **`05_collect_or_contribute` and `06_alliance_season_contribution`**, which is
   the only route to the per-member question.

Everything above is level-1, day-one data. `04`, `05`, `06` and `09` still want a
second pass once the map has filled in — see the re-capture list.
