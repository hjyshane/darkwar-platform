---
name: run-dashboard
description: Launch the Dark War dashboard against the local Supabase stack and drive it in a headless browser — load real fixtures, sign in as a member, screenshot the tabs, verify Realtime. Use when asked to run, start, screenshot or visually verify the dashboard, or to confirm a UI or schema change works in the real app rather than only in tests.
---

# Running the dashboard

Everything here runs in **WSL**. Only live capture needs Windows.

The whole point of this skill is that the mock hid two bugs for weeks — the
Members tab listed non-members, and the roster projection was silently
refused — and both appeared within minutes of putting real data behind a real
browser. Run it with real fixtures, not the seed alone.

## 1. Stack and data

```bash
supabase start                    # idempotent; skip if already running
supabase db reset                 # applies every migration + seed
```

**`db reset` destroys everything an admin typed.** Observations come back
from fixtures; `heroes` names, `announcements`, `app_settings` and the
alliance pin do not — nothing replays them, because a human is their only
source. This has already cost a session's worth of hero names, typed while
a migration was being applied in the background.

Reset when the schema has to be rebuilt from scratch. When the only thing
needed is a new migration on top of a database somebody is using, apply it
without touching their rows:

```bash
supabase migration up               # new migrations only, no seed, no wipe
```

And if a reset is genuinely required while someone might be entering data,
say so before running it — the cost falls on them, not on the run.

The fixture observations reference a collector that the seed does not create:

```bash
docker exec supabase_db_darkwar-platform psql -U postgres -q -c "
insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000c777','fixture-collector','offline','fixture')
on conflict do nothing;"
```

Then replay every committed fixture and drain the outbox. Keep the
`roster_redacted` fixture in — it is another alliance's roster, and loading it
alongside ours is what proves `is_own` discriminates instead of marking
everything.

`jq` is not installed here; read the secret key with python.

```bash
SECRET=$(supabase status -o json | python3 -c 'import sys,json;print(json.load(sys.stdin)["SECRET_KEY"])')

cd services/collector
export DW_COLLECTOR_ID=00000000-0000-4000-8000-00000000c777
uv run dw-collector init-db --db /tmp/dash.db
for f in ../../protocol-fixtures/decoded/*/*.json; do
  case "$f" in *malformed*|*nulls*|*mismatch*) continue;; esac
  uv run dw-collector replay --fixture "$f" --db /tmp/dash.db >/dev/null
done
until SUPABASE_URL=http://127.0.0.1:54321 \
      SUPABASE_SECRET_KEY="$SECRET" \
      uv run dw-collector sync --db /tmp/dash.db | tail -1 | grep -q 'sent=0'; do :; done
```

Sync sends 100 rows per call, so the loop matters — a single call looks like
success while thousands of rows are still pending.

**If the Members tab comes up empty, check this first:**

```sql
select current_name, current_code, is_own from public.alliances where is_own;
```

0031 sets `is_own` from an *unredacted* `al.rank` response. No roster loaded,
or only another alliance's, means no alliance is ours and the tab is empty by
design rather than broken.

## 2. Dev server

No `.env.local` is needed — `apps/dashboard/src/lib/env.ts` defaults to the
local stack and its publishable key.

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
nohup pnpm --filter @dw/dashboard dev > /tmp/vite.log 2>&1 &
timeout 60 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
```

Stop it by killing the port's listener, not the `pnpm` wrapper.

## 3. A member session

Most of the interesting columns are member-only, and logged out they render
"—" by design. Create the user through the Auth admin API, then grant the
role directly — the join-code flow is a separate thing to test, not a
prerequisite for looking at the app:

```bash
curl -s -X POST http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"email":"member@example.test","password":"dashboard-check-1","email_confirm":true}' >/dev/null
docker exec supabase_db_darkwar-platform psql -U postgres -q -c "
insert into public.app_users (user_id, role, display_name)
select id,'member','Dashboard Check' from auth.users where email='member@example.test'
on conflict (user_id) do update set role='member';"
```

Sign in at `#/login` with those credentials.

## 4. The browser

`chromium-cli` is not installed here and Playwright is deliberately **not** a
project dependency (see CLAUDE.md). Install both outside the repo so
`pnpm-lock.yaml` and `node_modules` stay untouched:

```bash
mkdir -p /tmp/driver && cd /tmp/driver && npm init -y >/dev/null
npm i playwright-core
npx --yes playwright@latest install chromium      # ~115 MB, into ~/.cache
```

The headless shell then fails to start on four missing `.so` files
(`libnspr4`, `libnss3`, `libnssutil3`, `libasound`), and there is no root
here. Fetch the three packages that carry them and unpack as a user —
`apt-get download` needs no privileges and `dpkg -x` writes wherever you point
it:

```bash
mkdir -p /tmp/libs && cd /tmp/libs
apt-get download libnspr4 libnss3 libasound2t64
for d in *.deb; do dpkg -x "$d" root; done
export LD_LIBRARY_PATH=/tmp/libs/root/usr/lib/x86_64-linux-gnu
export CHROME=$(ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
"$CHROME" --version    # confirm before writing a driver
```

Then drive it with `playwright-core`, launching with
`chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] })`.

## 5. What to actually check

Tabs are `#/`, `#/rankings`, `#/cross-server`, `#/arena`.

- **Wait for `table, p.empty` — never `networkidle`.** The Realtime socket
  stays open, so the page never goes idle and the wait times out.
- **Read cells by header text, not column index.** The Members tab is 11
  columns and has gained one twice; an index silently reads the wrong number.
- **Check `console --errors` equivalents.** A tab can render its shell while
  every query 500s.
- **Both viewports.** 1440 and 390. The body must never scroll sideways —
  `document.body.scrollWidth === clientWidth` — while `.table-wrap` scrolls
  internally. At 390, scroll `.table-wrap` fully right and confirm the name
  cell is still visible; it is `position: sticky` and that is easy to break.

### Realtime

The UI subscribes only to `data_change_notifications` (the sole snapshot-ish
table in the `supabase_realtime` publication) and maps topics to query keys.
To verify it, insert a snapshot and watch a cell change **without reloading**:

```sql
insert into public.alliance_contribution_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   contribution_type, score, rank, score_updated_at)
values
  (gen_random_uuid(), 'get.week.alliance.donate.rank', 'realtime-check',
   'realtime:check:' || extract(epoch from now()), now(),
   '00000000-0000-4000-8000-00000000c777', 580, 580,
   '<player_id>', <game_uid>, 'weekly_donation', 999111, 1, now());
```

Verified working 2026-08-01: the cell went 36,370 → 999,111 with no reload.
Watch that `data_change_notifications` actually gains a row — if it does not,
the fault is the notify trigger, not the socket.

## Gotchas that have actually bitten

- **`PGRST201` on an embed.** `players` and `alliances` are related twice
  (`players.current_alliance_id`, and `alliances.leader_player_id` pointing
  back), so an embed must name the FK:
  `alliances!players_current_alliance_id_fkey!inner(is_own)`. No test catches
  this; it only fails at runtime.
- **`204 No Content` with a body kills the connection** in a browser while
  curl tolerates it. This once looked like a broken favourites toggle when the
  app was fine.
- **Test both directions of a toggle.** Favourites was reported working after
  only "on" was tried.
