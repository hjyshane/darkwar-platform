# Releasing the desktop app

Two audiences read this file. Whoever cuts the release needs the steps and
the reasons a step exists. Whoever is about to hand the installer to a player
needs to know what that player is about to see, so the warning doesn't read
as "this is malware" and end with the file deleted.

Task 5 built the installer and proved the lifecycle claims in
`desktop-sidecar-lifecycle.md` hold across a real install/uninstall cycle —
this is the first real one, not a rehearsal. What's below is what that run
actually found, plus the steps to reproduce it. Nothing here has been run
against a second machine yet; that gap is worth closing before this goes to
more than a handful of people.

## Cutting a release

### 1. Bump the version, in all three places it lives

There is no single source of truth for the version number — three files
each carry their own copy, and nothing keeps them in sync automatically:

- `apps/desktop/src-tauri/tauri.conf.json` — `"version"` at the top level.
  This is the one that ends up in the installer's file properties and in
  the NSIS uninstall entry.
- `apps/desktop/src-tauri/Cargo.toml` — `[package] version`. Tauri's build
  reads this for the binary; Cargo will refuse a mismatch with the lockfile
  if you forget it.
- `apps/desktop/package.json` — `"version"`. Doesn't feed the installer
  directly, but a viewer of the package (or a future auto-update manifest)
  will read this one, and a drifted number here is exactly the kind of
  thing nobody notices until it matters.

All three read `0.1.0` as of this release. Bump all three together, in the
same commit as the sidecar rebuild below — a version bump with a stale
sidecar is worse than no bump at all, because the artifact *looks* like the
new release and behaves like the old one.

### 2. Rebuild the sidecar and copy it into `src-tauri/binaries/`

**This is the step that has bitten this project four separate times, and
it is the single most repeated mistake in this repo's history.** The
symptom is never a build failure — `pnpm tauri build` succeeds either way,
because Tauri just copies whatever file is sitting in
`src-tauri/binaries/` under the target-triple name. If that file is a
sidecar built before the last change to `services/collector`, the installer
is complete, signed-looking, and 20 MiB of confidently wrong: the window
opens, the reader endpoint answers, and the specific thing you just changed
either 404s or silently behaves like the old code. Nothing in the build
output says so.

```
uv run pyinstaller services/collector/dw-sidecar.spec
```

then copy the produced `dw-sidecar.exe` into
`apps/desktop/src-tauri/binaries/dw-sidecar-x86_64-pc-windows-msvc.exe` —
the target-triple suffix is what `externalBin` in `tauri.conf.json` expects,
and Tauri will not rename a bare `dw-sidecar.exe` for you.

Two things worth remembering about what this spec file packages, both
already commented at the top of `dw-sidecar.spec`:

- **It is a onefile build.** `externalBin` wants one executable to copy,
  and the unpack cost at start is not noticeable next to opening a window.
  `desktop-sidecar-lifecycle.md` documents the process shape this produces
  (a bootloader plus an inner interpreter) and why the exit path has to
  account for both.
- **It packages the read path only** — no `scapy`, no capture. Bundling
  capture here would roughly double the binary and drag Npcap's import into
  a process that never touches a network interface. If a future task adds
  capture to the shipped app, this spec file's `excludes` list is where that
  decision gets revisited, not silently overridden.

### 3. Build

```
pnpm --filter @dw/desktop tauri build
```

This runs `pnpm build` first (the `beforeBuildCommand` in
`tauri.conf.json` — `tsc --noEmit && vite build`), then invokes Tauri's
Rust build and NSIS packaging. The installer lands at

```
apps/desktop/src-tauri/target/release/bundle/nsis/Dark War_<version>_x64-setup.exe
```

Last measured: `Dark War_0.1.0_x64-setup.exe`, ~20 MiB.

### 4. Smoke test

Run this on a real Windows machine, not just a successful build log:

1. **Install.** `installMode: currentUser` in `tauri.conf.json` means this
   installs to `%LOCALAPPDATA%\Dark War\` with no admin prompt, and puts
   `dw-desktop.exe` and `dw-sidecar.exe` side by side — that adjacency is
   what makes the release build's `sidecar_path()` resolve at all; it is
   not incidental.
2. **Confirm the reader connects.** Open the app, run a search. If the
   window opens but says it could not start the reader, stop here — see
   "What breaks" below before going any further.
3. **Check the screens.** Profile, roster, arena — whatever the journal on
   this machine has coverage for. `local-screens.md` explains why an empty
   screen is not automatically a bug; the smoke test is about the screens
   that *do* have data rendering correctly, not about forcing every screen
   to be full.
4. **Uninstall, and confirm the journal survives.** The uninstaller's
   "Delete the application data" box is unchecked by default, and the
   journal at `%APPDATA%\us.cbfw.darkwar.desktop\collector.db` must still
   be there afterward. A player who uninstalls to troubleshoot and comes
   back later should not lose everything their game account has already
   surfaced.

## What to tell a player, before they download

This is the part that decides whether the file gets installed or deleted
the moment Windows objects to it. Say all of this up front, not as a reply
to a confused message after the fact.

### SmartScreen will very likely appear, and that's expected

This build's own install/uninstall test did **not** trigger SmartScreen —
worth saying plainly, because it means the exact wording below was not
reproduced on this artifact, only inferred from why it didn't show up.
The installer was built and run on the same machine, so it never picked up
a Mark-of-the-Web; SmartScreen's check keys off that mark, which only gets
attached when a file arrives via a browser, a network share, or another
"this came from outside" source. A player downloading `Dark War_0.1.0_x64-
setup.exe` through a browser will get the Mark-of-the-Web, and being
unsigned, will very likely see a screen along the lines of "Windows
protected your PC," with the way to proceed tucked behind a **More info**
link rather than offered as the main button. **Whoever ships the first copy
to an actual browser download should capture the literal wording and update
this section** — don't let this paragraph's inference stand in for someone
having actually seen it.

Tell them: this is normal for a small unsigned tool, it is not a sign the
file is broken or malicious, and the way past it is the More info link, not
the default button.

### Antivirus may flag or quarantine it — say why, not just that it might

Three things stack here, and naming them makes the warning less alarming,
not more:

- **PyInstaller-packed Python is a common heuristic trigger.** The sidecar
  bundles a Python interpreter into a single opaque executable, which is
  exactly the shape a lot of generic malware also takes — heuristic
  scanners key off the shape, not the content.
- **Packet capture makes it more suspicious still.** Even though the
  bundled sidecar is read-only (see the spec file note above — no `scapy`
  in this binary), the app as a whole is a capture tool, and Npcap plus a
  network-facing app is a pattern security software is tuned to notice.
- **Being unsigned removes the one thing that would otherwise offset both.**
  A code-signing certificate doesn't change what the binary does, but it is
  the credential AV heuristics and SmartScreen both use to decide "this
  publisher is accountable for this file." Without it, the first two points
  above have nothing to counterbalance them.

### Npcap has to be installed first, from the official source

Link to https://npcap.com. This app cannot bundle it — Npcap is a driver
with its own installer and its own licensing (see ADR 0001's "Npcap cannot
be bundled" consequence) — so a first-run without it will not capture
anything, or may not start at all depending on where the check lands. Tell
the player to install Npcap before running the app for the first time, from
npcap.com directly, not from a mirror.

### What the app actually does with their data — say it plainly

They are about to click through two separate security warnings to install
something that reads their game traffic. That's a real ask, and it deserves
a real answer, not just "trust me": the app captures only their own traffic
from their own game client, and everything it captures stays in a SQLite
file on their own machine (`%APPDATA%\us.cbfw.darkwar.desktop\collector.db`).
Nothing is uploaded anywhere — ADR 0001's whole first decision is that this
app never talks to the group's Supabase project at all. Say this before
they install, not only if they ask.

## What breaks, and how to tell

These runbooks already cover the failure shapes in depth; this is the index
that points at the right one instead of repeating it.

- **The window opens but says it could not start the reader** — the sidecar
  binary is missing from `src-tauri/binaries/` or is stale relative to the
  code it's supposed to be serving. See "Rebuild the sidecar" above, and
  `desktop-sidecar-lifecycle.md` for how the two processes are supposed to
  start up and shut down together.
- **Capture runs but rows stay at zero** — this is the failure that *looks*
  healthy: no error, no crash, just nothing landing in the journal. It
  almost always means the wrong network adapter is selected. `collector-
  setup.md` and `collector-operations.md` cover adapter selection; this is
  not a desktop-app-specific bug, it's the same trap the collector has
  always had.
- **The map picture is the wrong size, or pins land in the wrong place** —
  `map-agreement.md` is the full runbook for this, including the same-
  coordinate check, the corner check, and the image-size guard that turns a
  resized map picture into a loud banner instead of a silently wrong one.
  Re-run its checks after replacing either copy of `map.webp`.
- **A screen is empty** — `local-screens.md`'s closing section says this
  plainly: coverage follows attention. A profile, roster, or arena screen
  with nothing in it usually means this account's owner never opened that
  screen in game, not that the projection or endpoint is broken. What would
  be an actual bug is an empty screen that renders nothing explaining the
  emptiness — every screen is supposed to say so in a sentence, not a blank
  div.

## If a certificate is bought later

A certificate changes three things, and is worth revisiting once the group
using this app outgrows "a few people I already know use this tool with my
say-so":

- **Cost and identity, up front.** Roughly $200–400/year, and it is
  identity-verified — the issuer checks who is requesting it, not just that
  a payment cleared. For a private tool distributed to a known group, that
  verification overhead has so far bought nothing this ADR's threat model
  needs; the risk being managed today is "does this look untrustworthy to
  Windows," not "can someone impersonate the publisher."
- **Where the config goes.** Tauri's signing config lives in
  `tauri.conf.json` under `bundle.windows.certificateThumbprint` (or a
  timestamped signing command, depending on how the certificate is held —
  a hardware token vs. an exportable file changes which). It's an addition
  to the existing `bundle` block in that file, not a restructuring of it.
- **What actually changes once it's signed.** SmartScreen's warning stops
  appearing — that's the direct effect of the Mark-of-the-Web check finding
  a trusted signature. Antivirus false positives drop, because signature
  and publisher reputation are inputs those heuristics weigh, but they do
  not vanish outright — a signed PyInstaller binary that talks to a packet
  capture driver is still an unusual shape, just a less suspicious one.
- **Auto-update becomes worth having.** Tauri's updater plugin needs a
  signed artifact and a place to host the update manifest; neither exists
  today, so shipping a new version means a new download link each time.
  Once signing is in place, the second half of that — picking a host and
  wiring the updater — is a reasonable next ADR, not a hard requirement of
  this one.
