# Shared Map Drawing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search in the desktop app puts a pin on the same map, in the same place, as the web dashboard — with one copy of the coordinate maths and one stylesheet between them.

**Architecture:** A new `packages/ui` holds the pure parts: the projection, a framework-free layout function, and the map stylesheet. Each app keeps its own thin renderer — JSX in the dashboard, plain DOM in the desktop app — so neither has to adopt the other's framework.

**Tech Stack:** TypeScript, Vite, plain DOM, React (dashboard only), vitest.

---

## Read this before starting

**This phase touches production.** Every previous phase was additive: new files in `services/collector/desktop/` and `apps/desktop/`, nothing the web dashboard imported. This one moves files out of `apps/dashboard` and rewrites its map stylesheet.

`apps/dashboard` is what serves `https://cbfw.us`, and per `CLAUDE.md` every merge to `main` publishes it within about a minute with no gate in front. A visual regression here is a live regression on the thing other people actually use.

Two consequences, and they are not optional:

1. **The dashboard's map must look and behave identically when this is done.** Not "close enough".
2. **`MapCanvas` has no behavioural test coverage today.** `MapCanvas.test.ts` asserts three exported constants and never renders anything. So the safety net has to be built *before* the refactor, not after — Task 2 writes those tests first, against the current component, and they must pass unchanged afterwards.

## Why the split lands where it does

The repo's ADR says "what should be shared is the drawing, not the querying", and investigation showed how far that actually goes:

- `mapProjection.ts` — 81 lines, **zero imports**. Cleanly shareable, and the part that most needs to not drift: if the two apps disagree about where tile 310,622 is, both are confidently wrong in different places.
- `MapCanvas.tsx` — 179 lines, of which roughly 15 are React and roughly 90 are geometry and string building. It renders plain DOM, not a canvas: an `<img>` with absolutely-positioned `<span>`/`<button>` pins at percentage offsets.
- Its **entire visual identity lives somewhere else** — `apps/dashboard/src/index.css:3485-3588`, plus custom properties (`--accent`, `--bg`, `--border`, `--space-*`, `--radius-*`, `--text-sm`) defined elsewhere in that file. The desktop app has no stylesheet at all. A component transplanted without them renders as unstyled boxes.

So the seam is: projection + layout + stylesheet move to `packages/ui`; the JSX and the DOM shells stay in their apps.

The desktop app stays framework-free. Adding React to it would mean rewriting the settings screen and search built in the last phase, to share about ninety lines.

## Two hazards to fix while we are in here

**The inset is measured, not derived.** `MAP_INSET` is baked in as fractions of a specific 3164×2664 image, and `MapCanvas.test.ts` hardcodes the same numbers. The component's own comment says the picture will be replaced when the game changes the map — and when it is, every pin silently moves to the wrong place until somebody re-measures by hand. Task 4 makes a size mismatch loud.

**`MAP_IMAGE_URL = '/map.webp'`** is a browser static-asset root path. It works because Vite serves `apps/dashboard/public/`. Tauri's webview resolves that differently, so the constant has to become configurable rather than assumed.

## File Structure

**`packages/ui/`** — new, copying `packages/shared-types`' pattern exactly: plain TypeScript source, consumed through an `exports` map pointing at `./src/index.ts`, **no build step**.

| File | Responsibility |
|---|---|
| `package.json` | `@dw/ui`, exports source, no build script. |
| `src/index.ts` | The public surface. |
| `src/mapProjection.ts` | Moved verbatim. Coordinates only. |
| `src/mapLayout.ts` | Framework-free: markers in, positioned entries out. |
| `src/map.css` | The `.map-*` rules and the custom properties they need. |

**Unchanged in shape, changed in imports:** `apps/dashboard/src/features/map/MapCanvas.tsx` becomes a thin JSX shell.

**New:** `apps/desktop/src/mapView.ts` — the plain-DOM shell.

---

### Task 1: `packages/ui`, and the projection moved into it

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`
- Move: `apps/dashboard/src/lib/mapProjection.ts` → `packages/ui/src/mapProjection.ts`
- Move: `apps/dashboard/src/lib/mapProjection.test.ts` → `packages/ui/src/mapProjection.test.ts`
- Modify: the four importers

- [ ] **Step 1: Copy the pattern that already works**

Read `packages/shared-types/package.json` and `tsconfig.json` first and mirror them. That package is consumed straight from source via `"exports": {".": "./src/index.ts"}` with no build, resolved by pnpm's workspace symlink plus `moduleResolution: bundler`. Do not invent a different arrangement.

`packages/ui` needs a `test` script, because the root runs `pnpm -r test` and a member without one fails the whole run. It has real tests to run, so this is not a placeholder.

- [ ] **Step 2: Move the projection verbatim**

`git mv` both files so history follows. **Do not edit the contents** — not a comment, not a formatting change. This task must be provably a move.

- [ ] **Step 3: Update the importers**

Grep for `mapProjection` and fix every import to `@dw/ui`. Investigation found four: `MapCanvas.tsx`, `MapPage.tsx`, `mapLocations.ts`, and the test. Verify that list yourself rather than trusting it.

Add `"@dw/ui": "workspace:*"` to `apps/dashboard/package.json` and run `pnpm install` from the root.

- [ ] **Step 4: Prove it is a pure move**

```bash
git show --stat HEAD
git diff HEAD~1 -- packages/ui/src/mapProjection.ts
```
The second must show a rename with no content change. Report the output.

- [ ] **Step 5: Gate**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(ui): move the map projection into a shared package"
```

---

### Task 2: Behavioural tests for `MapCanvas`, before touching it

**Files:**
- Create/replace: `apps/dashboard/src/features/map/MapCanvas.test.tsx`

This is the safety net. It is written **against the current component, unchanged**, and must still pass after Task 3 rewrites its insides.

- [ ] **Step 1: Find out how to render a component in this repo's test setup**

Check whether `@testing-library/react` is already a dependency of `apps/dashboard`, and look at how any other component test renders. If nothing renders components today, say so and add the minimum needed — `@testing-library/react` plus a jsdom environment in the vitest config — and note in your report that you added a test dependency.

- [ ] **Step 2: Write tests that assert rendered output**

Cover, at minimum:
- a marker at a known coordinate lands at a known `left`/`top` percentage — pick a coordinate whose expected position you can compute by hand from `toFraction` and `MAP_INSET`, and **show that arithmetic in a comment**
- the map corners: `0,999` and `999,0` land at opposite corners
- `faded` and `highlighted` markers get their distinguishing classes
- the label is the marker's `label`, and a label longer than `LABEL_LIMIT` is handled the way the component currently handles it — read the code and pin the actual behaviour, do not invent a rule
- `calibrate` adds the calibration affordance
- an empty marker list renders the map and no pins

- [ ] **Step 3: Run them against the untouched component**

```bash
pnpm --filter @dw/dashboard test
```
They must pass **before** any refactor. If one fails, you have mis-read the component — fix the test, not the component.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(dashboard): pin what MapCanvas actually renders"
```

---

### Task 3: Extract the layout, keep the JSX shell

**Files:**
- Create: `packages/ui/src/mapLayout.ts`, `packages/ui/src/mapLayout.test.ts`
- Modify: `apps/dashboard/src/features/map/MapCanvas.tsx`

- [ ] **Step 1: Write the layout function and its tests**

`layoutMarkers(markers, options)` takes the marker list and returns positioned, framework-free entries — position as percentages, the label text, the class names, the title string, a stable key. Everything the current component computes between receiving props and emitting JSX.

Design the exact types yourself from what `MapCanvas` actually does. Move `MAP_INSET`, `LABEL_LIMIT` and `MAP_IMAGE_URL` alongside it, and re-export whatever `MapCanvas.test.ts` currently asserts so that test keeps working.

Test it directly: it is now a pure function and deserves better coverage than a component ever had.

- [ ] **Step 2: Make `MapCanvas` a shell**

Rewrite it to call `layoutMarkers` and render the result. It keeps its `useState`, its props, and its exported names.

- [ ] **Step 3: The tests from Task 2 must pass UNCHANGED**

```bash
pnpm --filter @dw/dashboard test
```
If you need to edit a Task 2 test to make it pass, **stop** — that means the rendered output changed, which is the one thing this task must not do. Report it rather than adjusting the test.

- [ ] **Step 4: Gate and commit**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
git commit -m "refactor(ui): share the map's layout maths between both renderers"
```

---

### Task 4: The stylesheet, and a picture that cannot lie

**Files:**
- Create: `packages/ui/src/map.css`
- Modify: `apps/dashboard/src/index.css`, `apps/dashboard/src/main.tsx` (or wherever CSS is imported)
- Modify: `packages/ui/src/mapLayout.ts`

- [ ] **Step 1: Move the map rules**

Move `.map-canvas`, `.map-frame`, `.map-frame__image`, `.map-plot`, `.map-pin`, `.map-pin__dot`, `.map-pin__label`, `.map-edge*` and `.map-plot--calibrate` out of `apps/dashboard/src/index.css` (around lines 3485-3588 — verify) into `packages/ui/src/map.css`.

**Every custom property those rules use must have a fallback**, so the stylesheet renders sensibly in an app that defines no theme: `var(--accent, #<something>)`. List the properties you found and the fallbacks you chose. The desktop app defines none of them, and unstyled pins on a map are worse than no map.

The dashboard imports `@dw/ui/map.css` and keeps its own variables, so its appearance is unchanged.

- [ ] **Step 2: VISUAL PROOF — the dashboard is unchanged**

This is the step that protects production. Before and after, run the dashboard, open the map, search a player, and screenshot the pin.

```bash
pnpm --filter @dw/dashboard dev
```

Compare the two screenshots and **report both**. Any visible difference in pin position, size, colour, label or the map frame is a failure of this task, not an acceptable variation.

- [ ] **Step 3: Make a wrong-sized picture loud**

`MAP_INSET` is fractions measured from a 3164×2664 image, and nothing checks that the image loaded is that size. Replace the picture and every pin moves, silently.

Add a check where the image's natural size is known — on load — comparing against the expected dimensions, and surface a clear complaint when they differ. Decide whether that is a console error, a visible banner, or a thrown error, and justify the choice: it must be impossible to miss but must not blank the map for a player.

Test it with a stub image element of the wrong size.

- [ ] **Step 4: Make the image path configurable**

`MAP_IMAGE_URL = '/map.webp'` assumes Vite's `public/` root. Make the URL a parameter with the current value as the default, so the desktop app can pass its own. Do not change what the dashboard resolves.

- [ ] **Step 5: Gate and commit**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
git commit -m "refactor(ui): ship the map's stylesheet with the map"
```

---

### Task 5: The desktop map

**Files:**
- Create: `apps/desktop/src/mapView.ts`
- Copy: the map image into `apps/desktop/public/`
- Modify: `apps/desktop/src/main.ts`, `apps/desktop/index.html`, `apps/desktop/package.json`

- [ ] **Step 1: Depend on the package**

Add `"@dw/ui": "workspace:*"` to `apps/desktop/package.json`, `pnpm install` from the root. No React, no JSX config — if you find yourself needing either, the layout function is not framework-free and that is a finding to report rather than work around.

- [ ] **Step 2: The image**

Copy `apps/dashboard/public/map.webp` (about 230 KB) to `apps/desktop/public/map.webp` and pass its URL into the layout.

Note in your report that the picture now exists twice, and that the comment in `MapCanvas` about replacing it when the game changes the map now means replacing it in two places. If you can see a clean way to avoid that within Vite's `public/` conventions, say what it is; do not build it in this task.

- [ ] **Step 3: Render**

`mapView.ts` renders the map and pins into a container using `document.createElement` and the entries from `layoutMarkers`, importing `@dw/ui/map.css`.

**`textContent` only.** Player names come from the journal and are chosen by other players, and `tauri.conf.json` still has `csp: null`. No `innerHTML`, no `outerHTML`, no `insertAdjacentHTML`, no markup from template strings. Grep your finished file for those four names and confirm it is clean.

- [ ] **Step 4: Wire it to search**

A search result puts a pin on the map. Keep the text list too — it carries the uid and capture time, which a pin does not.

- [ ] **Step 5: Gate and commit**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
git commit -m "feat(desktop): draw search results on the map"
```

---

### Task 6: Prove both, side by side

- [ ] **Step 1: The same coordinate, both apps**

Pick one player at a known coordinate that exists in both the local journal and the cloud data — or seed the local journal with a tile whose coordinates you also search for on the dashboard.

Open the dashboard's map and the desktop app's map, search the same player in both, and screenshot each.

**The pin must be in the same place.** Report both screenshots and say plainly whether they agree. If they do not, the shared layout is not being used identically and that is the bug this whole phase exists to prevent.

- [ ] **Step 2: The corners**

In the desktop app, seed and search tiles at `0,999` and `999,0`. Confirm they land at opposite corners of the picture, inside the frame. This is the check the dashboard's calibration mode exists for, applied to the new renderer.

- [ ] **Step 3: Record it**

Add a short section to `docs/runbooks/` covering how to re-verify the two maps agree after any change to the projection, layout or picture — including the corner check and the image-size guard from Task 4.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(ui): how to check both maps still agree"
```

---

## Done when

- `pnpm check && pnpm typecheck && pnpm test && pnpm build` passes at the root.
- The Task 2 tests pass unchanged from the moment they were written.
- The dashboard's map is visually identical, proven by before-and-after screenshots.
- The same player appears at the same place on both maps, proven by screenshots.
- A wrong-sized map picture produces a loud complaint rather than silently moved pins.

## What this deliberately does not do

- No React in the desktop app.
- No change to either app's data layer. The dashboard still reads PostgREST, the desktop app still reads its local journal, and `mapLocations.ts` stays where it is.
- No new map features — no clustering, no zoom, no multi-pin selection. This phase moves code and proves it still draws the same picture.
