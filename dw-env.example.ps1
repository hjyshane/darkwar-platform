# Copy to dw-env.ps1 (gitignored) and dot-source it before running the
# collector on Windows:   . .\dw-env.ps1
#
# The collector reads environment variables directly — there is no dotenv
# dependency, so a .env file is NOT picked up automatically. See
# docs/runbooks/collector-setup.md.

# --- Collector identity ------------------------------------------------------
# Keep this UUID stable: it is the collector's identity in the cloud, and
# changing it splits the heartbeat history.
$env:DW_COLLECTOR_ID = "00000000-0000-4000-8000-00000000c001"
# The server the collector ACCOUNT plays on — not the server of any observed
# player. A server.rank response from 580 carries players from all eight.
$env:DW_COLLECTOR_SERVER_ID = "580"

# --- Edge journal ------------------------------------------------------------
# Must be a LOCAL disk. SQLite WAL over a WSL/SMB share risks corruption.
$env:DW_SQLITE_PATH = "C:\DW_data\collector.db"

# --- Capture (Windows + Npcap) ----------------------------------------------
# scapy accepts the friendly adapter name. Find it with:
#   uv run python -c "from scapy.all import IFACES; IFACES.show()"
# Disconnect the VPN, or the game traffic is encrypted before it reaches here.
$env:DW_CAPTURE_INTERFACE = "Intel(R) Ethernet Controller (3) I225-V"
$env:DW_CAPTURE_PORT = "8680"

# --- Supabase ----------------------------------------------------------------
# The secret key bypasses RLS entirely (NFR-001), so it is never written into
# a template — not even the local one, because that habit is how a real key
# eventually lands in a repo. Fetch it from the running stack instead:
#   supabase status -o json    (SECRET_KEY)
$env:SUPABASE_URL = "http://127.0.0.1:54321"
$env:SUPABASE_SECRET_KEY = ""

# --- ADB / BlueStacks (UI automation, not needed for passive capture) -------
# Leave DW_ADB_COLLECTOR_SERIAL EMPTY until a dedicated collector account
# exists: the guard then refuses every automation action, which is correct.
# Never put the main account's serial here (FR-COL-010).
# Instance -> serial mapping lives in
#   C:\ProgramData\BlueStacks_nxt\bluestacks.conf  (bst.instance.*.adb_port)
$env:DW_ADB_COLLECTOR_SERIAL = ""
$env:DW_ADB_DENYLIST_SERIALS = "127.0.0.1:5555,127.0.0.1:5565,127.0.0.1:5575,emulator-5554,emulator-5564,emulator-5574"
# Creating this file halts all UI automation immediately (FR-OPS-006).
$env:DW_UI_KILL_SWITCH_FILE = "C:\DW_data\STOP_UI_AUTOMATION"
