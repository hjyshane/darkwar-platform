# DarkWar Discord Activity setup

DarkWar Tracker v0.4.0 serves the dashboard as a Discord Activity. The Activity
is a single-page web app backed by the existing local SQLite database and the
idle-aware refresh queue.

## Architecture

```text
Discord Activity iframe
        │ OAuth identify
        ▼
DarkWar Activity API (FastAPI, local PC)
        │
        ├── SQLite read-only dashboard queries
        └── refresh_jobs queue writes for approved admins

Dark War / BlueStacks → Passive Collector → SQLite
Refresh Worker ← refresh_jobs
```

The Activity does not receive the Dark War account token, packet captures, or
Discord Client Secret. The Client Secret stays only in `.env.activity` on the
server PC.

## 1. Install and build

From the tracker directory:

```powershell
.\setup.bat
.\setup_discord_activity.bat
```

The second command:

1. installs FastAPI/HTTPX/Uvicorn;
2. installs `@discord/embedded-app-sdk` and Vite;
3. builds `activity\dist`;
4. adds `[discord_activity]` to `config.toml` if missing;
5. creates `.env.activity` from the safe template if missing.

## 2. Create a Discord application

In Discord Developer Portal:

1. Create a new application, for example `DarkWar Command Center`.
2. Open **OAuth2** and add this Redirect URI:

   ```text
   https://127.0.0.1
   ```

3. Copy the **Application ID / Client ID**.
4. Reset or copy the **Client Secret**. Treat it like a password.
5. Under **Installation**, enable Guild Install. User Install may also remain
   enabled.
6. Under **Activities → Settings**, enable Activities and select the supported
   platforms you intend to use.

Enabling Activities creates the default `Launch` Entry Point command.

## 3. Configure local secrets and permissions

Edit `.env.activity`:

```dotenv
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your_private_client_secret
DARKWAR_ACTIVITY_DEV_USER_ID=your_discord_user_id
```

Do not share or commit this file.

Enable Discord Developer Mode, right-click your Discord profile, and choose
**Copy User ID**. Put that ID in `config.toml`:

```toml
[discord_activity]
enabled = true
host = "127.0.0.1"
port = 8765
viewer_user_ids = []
admin_user_ids = ["YOUR_DISCORD_USER_ID"]
timezone = "America/New_York"
max_rows = 200
allow_dev_bypass = false
```

Permission behavior:

- `viewer_user_ids = []`: any authenticated user who can launch the private
  Activity can view it.
- `admin_user_ids`: only listed users can queue or cancel refresh jobs.
- Listing viewer IDs restricts dashboard access to those users plus admins.

## 4. Start the Activity server

```powershell
.\start_discord_activity.ps1
```

Local health check:

```text
http://127.0.0.1:8765/api/health
```

The server must remain running while the Activity is in use. The collector and
refresh worker are separate processes:

```powershell
.\start_darkwar_services.ps1
```

## 5. Expose the Activity with HTTPS

Discord Activities require a public endpoint. For initial testing, install
`cloudflared`, then run:

```powershell
.\start_activity_tunnel.ps1
```

It prints a temporary hostname similar to:

```text
random-words.trycloudflare.com
```

In Discord Developer Portal, open **Activities → URL Mappings** and add:

| Prefix | Target |
|---|---|
| `/` | `random-words.trycloudflare.com` |

Do not include `https://` in the Target field.

A quick-tunnel hostname changes whenever the tunnel is restarted. For regular
use, configure a named Cloudflare Tunnel or another stable HTTPS reverse proxy
and point `/` to that stable hostname.

## 6. Launch inside Discord

1. Enable Discord Developer Mode.
2. Install the application into the intended private server.
3. Open the App Launcher in a text or voice channel.
4. Select `DarkWar Command Center` or its `Launch` entry.
5. Approve the `identify` OAuth permission when prompted.

The Activity will open directly inside Discord on supported desktop, web, or
mobile clients.

## Activity tabs

- **Overview** — weekly freshness, current Arena matchup, own alliance, changes.
- **Arena** — weekly matchup, Top 100, score/rank/power change, server summary.
- **Rankings** — cross-server player and alliance rankings.
- **Alliances** — search, roster, growth deltas, online/redacted state.
- **Players** — search, detailed power composition, history.
- **Refresh** — queue/cancel idle-aware refresh jobs and inspect job steps.

## Refresh behavior

Activity refresh buttons only add jobs to the existing SQLite queue.

```text
Discord Activity request
→ refresh_jobs
→ passive snapshot may satisfy the step
→ otherwise Refresh Worker waits for Windows idle
→ calibrated workflow runs
→ Activity updates in place
```

The Activity never bypasses idle detection. It does not directly tap BlueStacks.

## Local browser development

Only for local testing, set:

```toml
allow_dev_bypass = true
```

Then open `http://127.0.0.1:8765`. The API treats the local developer identity as
an admin when no explicit admin IDs are configured. Set this back to `false`
before exposing the server through a public tunnel.

## Troubleshooting

### Activity shows `DISCORD_CLIENT_ID is not configured`

Check `.env.activity`, then restart `start_discord_activity.ps1`.

### OAuth token exchange failed

Confirm the Client ID and Client Secret belong to the same Discord application.
Do not put quotes around them in `.env.activity`.

### Blank or old frontend

Rebuild:

```powershell
cd activity\client
npm install
npm run build
cd ..\..
```

Then restart the Activity server and relaunch the Activity rather than reloading
the iframe.

### `403` viewer or admin error

Copy the numeric Discord User ID and update `viewer_user_ids` or
`admin_user_ids` in `config.toml`.

### Activity URL does not load

Keep both windows running:

```text
start_discord_activity.ps1
start_activity_tunnel.ps1
```

Then verify the current tunnel hostname matches the `/` URL Mapping.
