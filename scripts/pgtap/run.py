"""Run the pgTAP suite against a throwaway PostgreSQL, on Windows or Linux.

run.sh's twin for the machine this project is developed on: no Docker, no
WSL, so `supabase test db` cannot run and run.sh (su, unix sockets) cannot
either. Every migration used to get its first real test in CI, one push and
one red db job per mistake.

Same steps as run.sh: a fresh cluster, supabase-stub.sql, every migration in
order, seed.sql, then every file in supabase/tests. Unlike run.sh's glob it
runs the three-digit files too (100+).

Needs PostgreSQL 17 binaries (CI's major version) with pgTAP installed into
share/extension. PGBIN points at the bin directory; otherwise the scoop
install is tried, then PATH.

    python scripts/pgtap/run.py              # everything
    python scripts/pgtap/run.py 104 108      # only tests whose name starts so

Exit status is 0 only when every file ran clean. As of 2026-09-29 this agrees
with CI on all 110 files, so any failure is worth believing; if it ever
disagrees, supabase-stub.sql is the first suspect.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCOOP_BIN = Path.home() / "scoop" / "apps" / "postgresql17" / "current" / "bin"
FAILURE = re.compile(r"^\s*not ok|ERROR:|Looks like|Bad plan", re.MULTILINE)


def find_bin() -> Path:
    for candidate in (os.environ.get("PGBIN"), SCOOP_BIN):
        if candidate and (Path(candidate) / exe("psql")).exists():
            return Path(candidate)
    found = shutil.which("psql")
    if found:
        return Path(found).parent
    sys.exit("no psql: set PGBIN to a PostgreSQL 17 bin directory")


def free_port() -> str:
    """A port nothing is listening on, so a cluster left behind by a killed
    run cannot make this one fail to start."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return str(s.getsockname()[1])


def exe(name: str) -> str:
    return name + (".exe" if os.name == "nt" else "")


def main(filters: list[str]) -> int:
    bin_dir = find_bin()
    port = os.environ.get("PGTAP_PORT") or free_port()
    work = Path(tempfile.mkdtemp(prefix="dw-pgtap-"))
    data = work / "data"
    env = {
        **os.environ,
        "PGOPTIONS": "-c search_path=public,extensions",
        "PGCLIENTENCODING": "UTF8",
    }
    psql = [str(bin_dir / exe("psql")), "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-X"]

    def run(args: list[str], **kw) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args, env=env, text=True, encoding="utf-8", errors="replace", capture_output=True, **kw
        )

    init = run(
        [
            str(bin_dir / exe("initdb")),
            "-D",
            str(data),
            "-U",
            "postgres",
            "-A",
            "trust",
            "-E",
            "UTF8",
            "--no-locale",
        ]
    )
    if init.returncode:
        sys.exit(init.stderr)
    log = work / "pg.log"
    # NOT captured: the server inherits pg_ctl's handles, so a captured pipe
    # never reaches EOF on Windows and this call would wait forever. The
    # server's own output goes to the log.
    start = subprocess.run(
        [
            str(bin_dir / exe("pg_ctl")),
            "start",
            "-D",
            str(data),
            "-w",
            "-l",
            str(log),
            "-o",
            f"-p {port} -c listen_addresses=127.0.0.1 -c fsync=off -c timezone=UTC",
        ],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if start.returncode:
        detail = log.read_text(errors="replace") if log.exists() else ""
        sys.exit(f"pg_ctl start failed:\n{detail}")
    try:
        return suite(run, psql, work, filters)
    finally:
        run([str(bin_dir / exe("pg_ctl")), "-D", str(data), "-m", "immediate", "stop"])
        shutil.rmtree(work, ignore_errors=True)


def staged(src: Path, work: Path) -> Path:
    """The two extensions not installed here: their call sites are inside
    plpgsql bodies nothing in the suite executes (run.sh does the same)."""
    text = src.read_text(encoding="utf-8")
    if src.name.endswith("_the_database_can_raise_the_alarm.sql"):
        text = re.sub(
            r"^create extension if not exists pg_net.*$",
            "-- [harness] pg_net not installed",
            text,
            flags=re.MULTILINE,
        )
        text = re.sub(
            r"^create extension if not exists pg_cron;$",
            "-- [harness] pg_cron stubbed in supabase-stub.sql",
            text,
            flags=re.MULTILINE,
        )
    out = work / src.name
    out.write_text(text, encoding="utf-8", newline="\n")
    return out


def suite(run, psql: list[str], work: Path, filters: list[str]) -> int:
    created = run([*psql, "-c", "create database dw"])
    if created.returncode:
        sys.exit(created.stderr)
    db = [*psql, "-d", "dw", "-q"]

    migrations = sorted((REPO / "supabase" / "migrations").glob("2026*.sql"))
    for f in [
        REPO / "scripts" / "pgtap" / "supabase-stub.sql",
        *migrations,
        REPO / "supabase" / "seed.sql",
    ]:
        applied = run([*db, "-v", "ON_ERROR_STOP=1", "-f", str(staged(f, work))])
        if applied.returncode:
            print(f"migration failed: {f.name}\n{applied.stderr[-3000:]}")
            return 1
    print(f"schema applied — {len(migrations)} migrations")

    tests = sorted(
        (REPO / "supabase" / "tests").glob("*_test.sql"), key=lambda p: int(p.name.split("_", 1)[0])
    )
    if filters:
        tests = [t for t in tests if any(t.name.startswith(f) for f in filters)]
    failed = 0
    for t in tests:
        # Unaligned, tuples only: bare TAP lines, as pg_prove would read them.
        result = run([*db, "-A", "-t", "-f", str(t)])
        out = result.stdout + result.stderr
        bad = [line for line in out.splitlines() if FAILURE.search(line)]
        # Detail lines pgTAP prints under a failure ("have:", "want:").
        detail = [line for line in out.splitlines() if line.startswith("#")]
        if bad:
            failed += 1
            print(f"\n── {t.stem}")
            print("\n".join(bad + detail[:30]))
    print(f"\n{len(tests)} files, {failed} with failures")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    # A Korean-locale console is cp949, which cannot print pgTAP's output (or
    # the names of this alliance's players) and would abort mid-suite.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main(sys.argv[1:]))
