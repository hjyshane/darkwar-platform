# Verifying the dashboard and desktop maps still agree

Two renderers draw the same world map: `apps/dashboard`'s `MapCanvas.tsx`
(React, a `<button>` or `<span>` per pin) and `apps/desktop`'s `mapView.ts`
(plain DOM, no framework at all — see `CLAUDE.md`). Neither one decides where
a pin goes. Both hand a marker list to `packages/ui/src/mapLayout.ts`'s
`layoutMarkers`, which calls `mapProjection.ts`'s `toFraction`, and draw
whatever comes back without adjusting it further:

- `MapCanvas.tsx` spreads the returned `position` straight into a JSX
  `style={position}`.
- `mapView.ts` does `pin.style.left = position.left; pin.style.top =
  position.top;` — two assignments, no arithmetic of its own.

**A change to `mapProjection.ts`, `mapLayout.ts`, `map.css`
(`packages/ui/src/map.css`, imported by both apps — see `2d59f10`), or the
`MAP_INSET`/`MAP_IMAGE_WIDTH`/`MAP_IMAGE_HEIGHT` constants moves both apps
at once, correctly or not.** There is no per-app copy left to drift — that
was the entire point of this phase (Tasks 1-5). This runbook is how to prove
that promise still holds after a change to any of those files, or to either
copy of the map picture.

If a change here ever needs one renderer to legitimately differ from the
other (a desktop-only zoom level, say), that is a new parameter threaded
through `layoutMarkers`'s options, not a fork of the function — forking it
is exactly the drift this phase exists to prevent.

## The same-coordinate check

The question this answers: **does a player at one coordinate land in the
same place on both maps?** If the two ever disagree, a base marked on the
dashboard is not where the desktop app says it is (or vice versa), which
defeats the reason `@dw/ui` exists at all.

### Seed the same tile in both apps

**Desktop** reads a real SQLite journal at
`%APPDATA%\us.cbfw.darkwar.desktop\collector.db`. Seed one tile through the
real `Journal` class (not hand-written SQL — `NormalizedRow.row` in
`services/collector/src/dw_collector/models.py` **is** the payload; wrapping
it in a second `{"row": ...}` double-nests it and `desktop/localread.py`
silently drops the tile, x/y/game_uid all coming back `None`):

```python
from dw_collector.models import NormalizedRow, Observation, idempotency_key
from dw_collector.storage.journal import Journal
# see the seed script this task used for the full shape — the field is
# row=payload, never row={"row": payload}
```

Reference tile used below: **ERHA SANGMAIMA, uid `1190060554000581`, at
310,622 on server 581** (the same fixture `services/collector/tests/
test_desktop_sidecar.py` and Task 5 verified against).

**Dashboard** has no backend here — Supabase is unreachable on this machine
(no Docker; see `apps/dashboard/src/dev/main.tsx`), so use the `dev:local`
fixture build Task 4 wired up. Add the SAME coordinate to
`apps/dashboard/src/dev/fixtures.ts` under the exact query keys
`useScannedServers`/`useSightingSearch` ask for (`['map', 'servers']` and
`['map', 'search', serverId, query.trim()]` — see `apps/dashboard/src/
features/map/mapLocations.ts`):

```ts
[['map', 'servers'], [{ serverId: 581, sweptAt: ago(20) }]],
[
  ['map', 'search', 581, 'erha'],
  [{ playerId: null, gameUid: 1190060554000581, name: 'ERHA SANGMAIMA',
     serverId: 581, at: { x: 310, y: 622 }, hqLevel: 34, capturedAt: ago(20) }],
],
```

The fixture only answers the exact trimmed search string it was given
(`'erha'`) — `MapPage.tsx`'s own `MIN_QUERY` (2 characters) is satisfied by
that, so there's no need to fixture every possible query.

### Run both

```
pnpm --filter @dw/dashboard dev:local     # opens index.dev.html
# then in the browser: #/map/581, search "erha", click the result
```

```
pnpm --filter @dw/desktop app             # tauri dev — a real window, real sidecar
# in the window: type "erha", click Find
```

### Read the numbers, don't eyeball them

**Dashboard**: open devtools on the running page and read the pin's own
inline style —

```js
document.querySelector('.map-pin').style.left  // "31.05%"
document.querySelector('.map-pin').style.top   // "37.75%"
```

**Desktop**: the window is a Tauri/WebView2 process, not a browser tab — the
Chrome-based devtools tooling this repo otherwise uses does not attach to
it, and driving its native `Inspect` context menu (confirmed present; right-
click on the map area) is possible but slow and manual. The equivalent
proof, without opening it by hand: query the sidecar's real HTTP endpoint
directly for the tile the window is showing, then feed that tile through
the literal `layoutMarkers` function `mapView.ts` imports —

```bash
# find the sidecar's port (it's chosen at random per run)
# PowerShell: Get-NetTCPConnection -State Listen | where { (Get-Process -Id $_.OwningProcess).ProcessName -match 'dw-sidecar' }
curl http://127.0.0.1:<port>/find?q=erha
```

then, inside `packages/ui`, a one-off `vitest` assertion (or any script that
imports `layoutMarkers`) against the coordinate the sidecar returned:

```ts
import { layoutMarkers } from './mapLayout';
layoutMarkers([{ at: { x: 310, y: 622 }, label: 'ERHA SANGMAIMA' }])[0].position;
// { left: '31.05%', top: '37.75%' }
```

This is not a reimplementation of the check — it is the exact function
`mapView.ts` calls, and `mapView.ts` assigns its two fields to `style.left`/
`style.top` with no transformation in between, so the DOM value the window
is actually painting cannot differ from this without `mapView.ts` itself
changing. Reading it this way also proves the full real path end to end:
the actual SQLite journal → the real sidecar's `/find` → the same
`layoutMarkers` the renderer calls.

### Reference numbers (measured 2026-09-07)

ERHA SANGMAIMA, 310,622, server 581:

| | left | top |
|---|---|---|
| Dashboard (`.map-pin` inline style, `dev:local`, `#/map/581`) | 31.05% | 37.75% |
| Desktop (`layoutMarkers` fed the sidecar's real `/find` response) | 31.05% | 37.75% |

**Match.** Both also derive from the same arithmetic by hand, as a sanity
check on the check itself: `toFraction` puts a tile's centre at `(x + 0.5) /
1000`, and flips y (`(999 - y + 0.5) / 1000`, since the map's top-left is
`0,999` — see `mapProjection.ts`'s "Y AXIS IS UPSIDE DOWN" comment). For
`x=310`: `(310.5)/1000 = 31.05%`. For `y=622`: `(999-622+0.5)/1000 =
377.5/1000 = 37.75%`.

If these two rows ever come back different, **that is the bug this whole
phase existed to prevent — stop and report it, do not "fix" one renderer to
match the other without first finding which one (or both) is wrong against
the formula above.**

## The corner check

The question this answers: **do the two coordinate system's defined corners
(`0,999` top-left, `999,0` bottom-right — see `mapProjection.ts`) land at
opposite corners of the picture, inside the green border, and not outside
it or squarely on top of it?** This is what the dashboard's `calibrate` mode
(`MapPage.tsx`'s "Show map bounds" checkbox) draws for a human to eyeball;
this section is the same question answered with the same reference numbers
so a regression doesn't need the checkbox to be caught.

Seed both corners (server 581, distinct uids) and search each in the
desktop app:

| Tile | plot-relative (from `layoutMarkers`) |
|---|---|
| `0,999` (top-left) | left 0.05%, top 0.05% |
| `999,0` (bottom-right) | left 99.95%, top 99.95% |

These are **plot-relative**, not image-relative — `MapInset` (see
`mapLayout.ts`) is applied once, to the plot container, and never to an
individual marker. Folding in today's `MAP_INSET` (`55/3164` horizontal,
`55/2664` vertical, i.e. 1.7389%/2.0646% of the full picture on each side)
gives where each corner actually lands on the full 3164×2664 picture:

| Tile | image-relative left | image-relative top |
|---|---|---|
| `0,999` | ≈1.79% | ≈2.11% |
| `999,0` | ≈98.21% | ≈97.89% |

Both sit strictly inside `MAP_INSET`'s boundary (1.74%–98.26% horizontally,
2.06%–97.93% vertically) — on the inside of the green border, not on it and
not outside it, which is what "inside the frame" means here. Confirmed
visually too: seeding both corners in the running desktop app and searching
"corner" shows one pin sitting right at the inner edge of the border
top-left, the other at the inner edge bottom-right, symmetric across the
picture.

If a corner ever lands outside `MAP_INSET`'s boundary, or the two corners
stop being symmetric across the centre, `MAP_INSET` has drifted from the
picture it was measured against — see the image-size guard below, this is
usually the same root cause.

## The image-size guard

`MAP_INSET`'s four fractions were measured against one specific picture:
3164×2664 (`MAP_IMAGE_WIDTH`/`MAP_IMAGE_HEIGHT` in `mapLayout.ts`). Nothing
stops someone from dropping in a differently-sized replacement when the game
changes its map — and a resized picture with the old `MAP_INSET` silently
moves every pin by the difference, with no error and no crash.

`checkMapImageSize` (shared, `packages/ui/src/mapLayout.ts`) is the one
place that check happens: both `MapCanvas.tsx`'s `onLoad` and `mapView.ts`'s
`load` listener call it with the loaded picture's `naturalWidth`/
`naturalHeight`, and both turn a non-`null` result into a **standing banner**
(`role="alert"`, plus `console.error`) — not a thrown error, not a blanked
map. A thrown error or an empty map would be just as loud, but would take
the map away from every player the instant someone replaces the picture,
before anyone has had the chance to remeasure `MAP_INSET` — worse than
showing a (possibly now slightly wrong) map with a warning on top of it.

**The picture lives in two separate files, not one:**
`apps/dashboard/public/map.webp` and `apps/desktop/public/map.webp` (see
`mapView.ts`'s `DESKTOP_MAP_IMAGE_URL` comment — Vite resolves a
root-relative path against each app's own `public/` directory, so this is
two files by construction, not an oversight). **Replacing the map means
replacing both copies and re-measuring `MAP_INSET` once against whichever
one you just dropped in** — measuring against only one and assuming the
other matches is exactly the kind of drift this phase exists to catch. Redo
the same-coordinate and corner checks above after any picture replacement,
against the NEW `MAP_INSET` you measured.

## Why a dashboard mistake here is louder than a desktop one

`apps/dashboard` publishes to `cbfw.us` on every merge to `main`, with **no
CI gate in front of it** (see `CLAUDE.md`'s "Merging to main publishes the
dashboard" — the Actions runs are red on every commit for an unrelated
billing reason, so nothing blocks a bad merge from going live within about a
minute). A map regression that ships this way is not caught by anyone until
a player notices their own base is drawn in the wrong place. The desktop app
has no equivalent auto-publish path — a bad build there only ships when
someone runs the installer — so **the dashboard side of this check is the
one worth re-running before every merge that touches `packages/ui`'s map
code, the map stylesheet, or either copy of the picture**, not just when
convenient.
