# DarkWar Tracker v0.4.0 patch

This patch adds a Discord Activity dashboard while retaining the v0.3.0
Streamlit dashboard, collector, SQLite history, Arena support, and idle-aware
refresh queue.

## Before applying

Stop:

- Passive Collector
- Refresh Worker
- Streamlit Dashboard
- any earlier Arena Scheduler

Back up the database:

```powershell
cd C:\darkwar-adb\darkwar_tracker
Copy-Item .\data\darkwar.sqlite3 .\data\darkwar_backup_v0.4.0.sqlite3
```

## Apply

Extract the v0.4.0 patch over the existing tracker directory.

The patch does not include:

```text
config.toml
data\
.env.activity
activity\client\node_modules\
```

Your existing database and local credentials are preserved.

## Update Python and build the Activity

```powershell
.\setup_discord_activity.bat
```

Then edit:

```text
.env.activity
config.toml [discord_activity]
```

Add your numeric Discord User ID to `admin_user_ids`.

## Migrate and test

```powershell
.\.venv\Scripts\python.exe -m darkwar_tracker.migrate --config config.toml
.\.venv\Scripts\python.exe .\scripts\test_discord_activity.py
```

Expected:

```text
discord activity API regression test passed
```

Existing regressions may also be run:

```powershell
.\.venv\Scripts\python.exe .\scripts\test_refresh_policy.py
.\.venv\Scripts\python.exe .\scripts\test_idle_detection.py
.\.venv\Scripts\python.exe .\scripts\test_arena_weekly.py
.\.venv\Scripts\python.exe .\scripts\test_player_profiles.py
```

## Start

Collector and refresh worker:

```powershell
.\start_darkwar_services.ps1
```

Discord Activity API:

```powershell
.\start_discord_activity.ps1
```

Temporary HTTPS tunnel for initial Discord testing:

```powershell
.\start_activity_tunnel.ps1
```

Configure the generated hostname as the `/` URL Mapping in Discord Developer
Portal. See `DISCORD_ACTIVITY_SETUP.md` for the complete portal setup.

## New files

```text
DISCORD_ACTIVITY_SETUP.md
activity_env.example
discord_activity_config_snippet.toml
setup_discord_activity.bat
start_discord_activity.ps1
start_activity_tunnel.ps1
start_discord_activity_services.ps1
test_activity_api.bat
activity\client\...
darkwar_tracker\activity_api.py
scripts\add_discord_activity_config.py
scripts\test_discord_activity.py
```
