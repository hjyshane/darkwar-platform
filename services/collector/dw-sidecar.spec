# PyInstaller spec for the desktop app's Python half.
#
# ONE FILE, not one folder: Tauri's externalBin wants a single executable to
# copy, and the sidecar is small enough that the unpack cost at start is not
# noticeable next to opening a window.
#
# NOT THE COLLECTOR. This packages only the read path — no scapy, no capture.
# Bundling capture here would roughly double the binary and drag Npcap's
# import into a process that never touches a network interface.

a = Analysis(
    ["src/dw_collector/desktop/__main__.py"],
    pathex=["src"],
    binaries=[],
    datas=[],
    hiddenimports=[],
    excludes=["scapy", "tkinter", "httpx", "typer"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    # CONSOLE=TRUE ON PURPOSE. The port announcement goes to stdout and the
    # Rust parent reads it; a windowed build has no stdout, so the window
    # could never find the sidecar it just started.
    console=True,
    name="dw-sidecar",
    upx=False,
)
