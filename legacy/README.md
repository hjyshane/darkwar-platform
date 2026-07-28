# Quarantine

`legacy/v0.4.1/` holds the DarkWar Tracker v0.4.1 prototype, imported verbatim.
It is **reference material, not part of the build.** Nothing here is compiled,
linted, type-checked, tested, or imported.

The point is not to hide the code. It is to stop unreviewed prototype code from
becoming the foundation by default — which is what happens when legacy source
sits on the import path and someone reaches for it "just for now".

## Importing

One branch, one commit, zero edits:

```bash
git switch -c import/v0.4.1
# copy SOURCE ONLY into legacy/v0.4.1/ — no reformatting, no renames, no fixes
git add legacy/
git commit -m "chore(legacy): import DarkWar Tracker v0.4.1 verbatim (quarantined, not built)"
git switch main
git merge --no-ff import/v0.4.1 -m "merge: quarantined v0.4.1 import"
```

Any edit mixed into that commit destroys the ability to diff promoted code
against the original. `--no-ff` keeps the import revertible in one step
(`git revert -m 1 <merge>`). Never rebase or squash it.

## What must not come along

PCAPs, SQLite databases, and `.env` files stay **outside the repo**, in a
sibling directory (for example `D:\DW_legacy_data\`). A sibling cannot be swept
up by `git add -A`; a subdirectory can.

Login captures contain the collector account's UID and session signature. In
git history that is permanent, private repo or not. `.gitignore` and gitleaks
are the backstop, not the plan — check what you are copying before you copy it.

## Promotion

Code leaves quarantine by being **rewritten into `services/collector/src/`**,
not moved. One parser per pull request, and it does not land without:

1. a sanitized decoded fixture in `protocol-fixtures/decoded/<command>/`
2. a manifest in `protocol-fixtures/manifests/` recording the source PCAP's
   sha256, capture time, UI actions, and which fields were stripped
3. a replay test covering normal, null/optional, malformed, and duplicate cases

This is NFR-009 and Gate 1 stated as a merge gate. Record each file's verdict —
adopt, discard, or reference-only — in `docs/legacy-triage.md`.

Sanitizing means running the decoder over the PCAP and committing the resulting
JSON with UID, session signature, IP addresses, and device identifiers removed.
The raw PCAP never enters the repo.

## Retirement

When `docs/legacy-triage.md` has no pending rows, delete the directory:

```bash
git rm -r legacy/
```

History keeps it. The working tree stops offering it.
