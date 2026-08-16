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

## Until then

No tables, no tab. `CLAUDE.md` puts season and map under "not being built yet"
for this reason, and the reason is evidence, not preference. When the captures
are read, that entry is what gets updated first.
