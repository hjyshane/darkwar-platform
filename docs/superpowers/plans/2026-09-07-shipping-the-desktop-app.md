# Shipping the Desktop App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installer you can hand another player, and a page telling them what to expect when Windows warns them about it.

**Architecture:** No new runtime pieces. This phase finishes the ones already built: a real icon wired to the bundler, a content security policy instead of none, a coherent first run, and an NSIS installer proven by actually installing it.

**Tech Stack:** Tauri v2 bundler, NSIS, PyInstaller.

---

## The decision this phase is built on

**The app ships unsigned.** A code-signing certificate is roughly $200-400 a year and needs identity verification, and this is a private tool for a group of eight people who can be told what to expect.

That decision has consequences that must be *documented rather than discovered*:

- **SmartScreen will warn.** "Windows protected your PC", with the Run-anyway button hidden behind "More info". A player who was not told this will assume malware and stop.
- **Antivirus false positives are likely, not possible.** PyInstaller-packed Python is a common heuristic trigger on its own; add a bundled `dumpcap` invocation and packet capture and the odds go up. Unsigned makes every heuristic more suspicious.
- **There is no auto-update.** New versions are a new download, by hand.

None of that is a reason not to ship. It is a reason the release runbook in Task 6 is a deliverable, not paperwork: the difference between a tool people install and one they delete is being told in advance which scary dialog is expected.

## What only you can do

Nothing in this plan needs a secret or a purchase. If a certificate is bought later, Task 6's runbook records exactly what changes — but no step here is blocked on it.

## Two things that have never actually been exercised

**The release sidecar path.** `sidecar_path()` has a `debug_assertions` split: in dev it reads the binary out of the source tree, in release it takes `current_exe().parent().join("dw-sidecar.exe")`. Everything so far has run under `tauri dev`. One earlier task built a release binary and renamed the sidecar beside it to test a failure path, but **no installed build has ever been run.** Task 5 is where that either works or does not.

**`csp: null`.** Every screen has been written under no policy at all. Turning one on can break things that silently worked — an inline style, an image URL, the IPC bridge. Task 2 is not "add a line to a config file", it is "add it and then check every screen".

## File Structure

| File | Change |
|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | icon set, CSP, version, installer metadata |
| `apps/desktop/src-tauri/icons/` | a generated icon set replacing the lone placeholder |
| `apps/desktop/src/main.ts` | first-run routing |
| `docs/runbooks/releasing-the-desktop-app.md` | new |

---

### Task 1: An icon that is actually in the build

**Files:** `apps/desktop/src-tauri/icons/*`, `apps/desktop/src-tauri/tauri.conf.json`

`icons/icon.ico` today is a 32×32 solid-colour placeholder created only to satisfy `tauri-build`'s Windows resource step. **`bundle` has no `icon` key at all**, so a real `tauri build` ships a generic icon no matter what that file contains.

- [ ] **Step 1: Make a source image**

Generate a 1024×1024 PNG. A plain, deliberate mark — a monogram or simple geometric device on a flat ground, legible at 16×16. Not artwork; something that looks chosen rather than defaulted.

Write the generator as a small script in your scratchpad (Pillow or raw PNG encoding), keep the resulting PNG at `apps/desktop/src-tauri/icons/source.png` so it can be regenerated, and delete the script.

**Check it at 16×16 before continuing.** An icon that is a grey smudge in the taskbar has failed at the only size that matters most.

- [ ] **Step 2: Generate the set**

```bash
pnpm tauri icon src-tauri/icons/source.png
```
from `apps/desktop/`. Report what it produced.

- [ ] **Step 3: Wire it into the bundle**

Add the `icon` array to `bundle` in `tauri.conf.json`, listing what the generator emitted. Without this the files are decoration.

- [ ] **Step 4: Prove it is in the artifact**

Build (`pnpm tauri build`) and confirm the icon appears on the produced `.exe` in Explorer and on the window. **A screenshot of the file in Explorer is the proof** — not the presence of files on disk.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): give the app an icon the bundler actually uses"
```

---

### Task 2: A content security policy, and every screen checked under it

**Files:** `apps/desktop/src-tauri/tauri.conf.json`

`"security": {"csp": null}` means no policy. Every screen was written assuming that, and every screen renders strings chosen by other players — names out of the journal, `dumpcap`'s own error text, adapter labels. `textContent` everywhere is the first line of defence; this is the second.

- [ ] **Step 1: Work out what the app actually needs**

Before writing a policy, enumerate: the map image's URL, any fonts, the Tauri IPC bridge's requirements, and whether anything sets inline styles (the map pins do — `style.left`/`style.top`). Read Tauri v2's CSP documentation for what the IPC layer needs.

Write the policy to be as tight as the app allows, and **record in a comment what each directive is for**. A policy nobody can explain gets loosened at the first inconvenience.

- [ ] **Step 2: Check every screen under it**

`pnpm app`, then visit **all six**: search, map, profile, roster, arena, settings.

For each, confirm it still renders and works, **and check the webview console for CSP violations** — a violation is silent to the eye and loud in the console. Report per screen.

Pay attention to: the map image loading, pins positioning (inline styles), the adapter dropdown populating, capture start/stop.

- [ ] **Step 3: Check the release build too**

Dev and release differ in how assets are served. Build and run the release binary, and repeat the check. Report anything that differs.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): give the window a content security policy"
```

---

### Task 3: Version and installer metadata

**Files:** `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/package.json`

`version` is `"0.0.0"`. The installer shows it, Add/Remove Programs shows it, and a bug report that says "0.0.0" identifies nothing.

- [ ] **Step 1: Set a real version**

`0.1.0` — first thing anybody else runs, not yet feature-complete. Check every place a version is declared and make them agree; report which files you found.

- [ ] **Step 2: Installer metadata**

Look at what Tauri's NSIS bundler accepts — publisher, description, licence, install mode (per-user versus per-machine). **Prefer per-user install**: it needs no elevation, which is one less scary prompt on top of SmartScreen, and this app writes only to its own app-data directory anyway.

Say what you set and why, and note anything you deliberately left unset.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(desktop): real version and installer metadata"
```

---

### Task 4: A coherent first run

**Files:** `apps/desktop/src/main.ts`, and the views as needed

A brand-new install has no settings file, no journal, and no capture. Today the window opens on search — a search box over an empty journal, with the reason buried on another tab.

- [ ] **Step 1: Decide where a fresh install lands**

If there is no journal and no interface configured, the first useful action is settings, not search. Route there on first run, with a sentence saying why.

Do not make this clever. A one-time check of whether the app has ever been configured is enough; do not build an onboarding framework.

- [ ] **Step 2: Make the Npcap path clear**

`/adapters` already reports `no-dumpcap`, and settings already says Npcap is not installed. Confirm that reads well as the *first* thing a new player sees, and that it names what to install and where to get it. Improve the wording if it assumes context a new user does not have.

- [ ] **Step 3: Try it as a new user**

Move your existing settings file and journal aside — **do not delete them**, they are the fixtures every earlier task seeded. Launch the app and report exactly what a first run looks like, screenshot included. Then restore them.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): land a fresh install on settings, not an empty search"
```

---

### Task 5: Build the installer, install it, run it

This is the task the phase exists for. Everything until now has run from a source tree.

- [ ] **Step 1: Build**

```bash
pnpm tauri build
```
from `apps/desktop/`. Report where the installer landed and how big it is.

**Confirm the sidecar is inside it.** `externalBin` should place `dw-sidecar.exe` beside the app's executable — check the installer's payload or the installed directory, not just the config.

- [ ] **Step 2: Install it**

Run the installer as a player would. Report what Windows said — **including the exact SmartScreen wording**, since Task 6's runbook has to quote it.

- [ ] **Step 3: Run the installed app and exercise everything**

Not `tauri dev` — the installed copy, from wherever it installed to.

**This is the first time `sidecar_path()`'s release branch has ever run.** It resolves `current_exe().parent().join("dw-sidecar.exe")`. If it is wrong, the window opens and says it could not start the reader.

Check: the window opens; the reader connects; all six screens work; the map image loads; capture can start and stop; closing the window leaves **no `dw-desktop`, `dw-sidecar` or `dumpcap` process** (`tasklist`).

Report each.

- [ ] **Step 4: Note what antivirus did**

Report honestly whether anything was flagged, quarantined or delayed — on this machine, with whatever is installed. If nothing happened, say that; it is one data point, not a guarantee for others.

- [ ] **Step 5: Uninstall**

Uninstall through Windows. Confirm the program files are gone, and report **whether the app-data directory and the player's journal survive** — they should. An uninstall that deletes somebody's capture history is a bug.

- [ ] **Step 6: Commit anything that had to change**

If the release build revealed a bug, fix it in its own commit and say what it was.

---

### Task 6: The release runbook

**Files:** `docs/runbooks/releasing-the-desktop-app.md`

Two audiences: you, cutting a release, and the player installing one.

- [ ] **Step 1: Write it**

Cover:

**Cutting a release** — bump the version in the places Task 3 found; rebuild the sidecar (`uv run pyinstaller dw-sidecar.spec --noconfirm`) and copy it to `src-tauri/binaries/` with the target-triple name, because a stale sidecar has caught out three separate tasks already; `pnpm tauri build`; where the artifact lands; the smoke test from Task 5.

**What to tell a player, in advance** — quote the exact SmartScreen wording from Task 5 and the click path through it; that antivirus may flag or quarantine it, and why (PyInstaller plus packet capture, unsigned); that **Npcap must be installed first** and where from; that the app captures only their own traffic and keeps everything on their machine, which is worth stating plainly since they are being asked to click through two security warnings.

**What breaks and how to tell** — the app opens but says it could not start the reader; capture runs but rows stay at zero (wrong adapter, the failure that looks healthy); the map picture is the wrong size. Point at `docs/runbooks/local-screens.md`, `map-agreement.md` and `desktop-sidecar-lifecycle.md` rather than repeating them.

**If a certificate is bought later** — what changes: the signing config, that SmartScreen stops, that AV false positives drop but do not vanish, and that auto-update becomes worth revisiting. Enough that the decision can be made later without re-deriving it.

Match the house voice: explain WHY, not just steps.

- [ ] **Step 2: Update the ADR**

ADR 0001's phase 6 line says "installer, Npcap wizard, auto-update, signing". Record what was built, that signing and auto-update were deliberately deferred with the reasoning, and point at the runbook.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: how to cut a release, and what to tell whoever installs it"
```

---

## Done when

- The installer builds, installs, runs, and uninstalls without taking the journal with it.
- All six screens work from an installed copy, not just a dev server.
- A CSP is on and no screen violates it.
- The icon is on the executable and the window.
- The runbook says what a player will see before they see it.

## What this deliberately does not do

- No code signing and no auto-update. Both were considered; the runbook records what changes if that reverses.
- No installer for anything but Windows. The collector is Windows-only by an existing decision.
- No telemetry. The app is local-only; there is nowhere for it to report to, by design.
