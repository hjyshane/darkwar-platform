"""`python -m dw_collector.desktop` and the PyInstaller build both need a
module entrypoint. The sidecar is the only thing in this package that runs."""

from dw_collector.desktop.sidecar import main

if __name__ == "__main__":
    raise SystemExit(main())
