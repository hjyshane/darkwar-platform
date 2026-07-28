# DarkWar Platform

Private, personal tooling for tracking player/alliance activity on Dark War
Survival server group 577-584. Not a product, not distributed, not for sale.

The full specification lives at
[`docs/DarkWar_Platform_Technical_Specification_v1.0.md`](docs/DarkWar_Platform_Technical_Specification_v1.0.md).
It is the source of truth for requirements, data contracts, and gates. This
README only covers getting the repo running.

## Layout

```
apps/dashboard/       Vite + React SPA — serves both web and Discord Activity
packages/shared-types Generated DB types + Zod contracts shared with the app
services/collector/   Python 3.12 package; four console entrypoints
supabase/             Migrations, pgTAP tests, seed data
protocol-fixtures/    Sanitized decoded payloads (never raw PCAPs)
legacy/               Quarantined v0.4.1 import — read-only, never built
docs/                 Specification
```

Directories not listed here are created when first needed, not up front.

## Prerequisites (Windows)

Development happens on the Windows collector PC: packet capture, BlueStacks,
and ADB are Windows-only, and the v0.4.1 prototype already lives there. WSL is
not used — the collector needs Npcap, ADB, and SQLite in one process tree.

| Tool | Version | Notes |
|---|---|---|
| Git | 2.40+ | `git config --global core.longpaths true` |
| Node | 22 LTS | then `corepack enable` for pnpm |
| uv | latest | installs and pins Python 3.12 itself |
| Docker Desktop | latest | WSL2 backend, for the local Supabase stack |
| Supabase CLI | latest | |
| Npcap | latest | capture only; install in WinPcap-compatible mode |

Add `node_modules`, `.venv`, `.git`, and the collector data directory to
Windows Defender's real-time scan exclusions, or installs and test runs crawl.

## Setup

```bash
pnpm install
uv sync --directory services/collector
cp .env.example .env      # then fill it in
supabase start
supabase db reset         # applies migrations + seed
```

Add `--extra capture` to the `uv sync` when you need live packet capture; the
default install deliberately omits it so CI and tests run without Npcap.

## Common commands

```bash
pnpm dev                                    # dashboard at localhost:5173
supabase db reset                           # rebuild schema from migrations
supabase test db                            # pgTAP, including RLS negatives
uv run --directory services/collector pytest
```

Replay a fixture through the whole pipeline without any live capture:

```bash
uv run --directory services/collector dw-collector replay --fixture ../../protocol-fixtures/decoded/al.rank/synthetic_roster_v1.json
```

## Rules that are not negotiable

- **Never commit `.pcap`/`.pcapng`, `*.db`, or `.env`.** Login captures contain
  the collector account's UID and session signature. Raw captures and databases
  live in a sibling directory outside this repo.
- **The Supabase secret key bypasses RLS.** It goes in `.env` and GitHub
  Actions secrets only — never in a `VITE_*` variable.
- **`legacy/` is read-only reference.** Nothing imports from it. Code leaves
  quarantine only by being rewritten, with a fixture and a replay test.
- **Automation touches the collector BlueStacks instance only.** The main
  account's ADB serial is on a denylist (FR-COL-010).
