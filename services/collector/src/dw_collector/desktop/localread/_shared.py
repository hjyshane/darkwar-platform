"""SQL and cache plumbing shared by every projection in this package.

Split out of the original single-file `localread.py` (Task 3b) once a second
projection (player profiles, Task 2 of the calculator plan) needed the exact
same SELECT shape and the exact same file-keyed fold cache. Factoring this out
means the player and detail projections inherit the reasoning already proven
for tiles — the covering-index ordering, the cache's file key, the
outside-the-lock fold — rather than a second, drifting copy of it.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable

# ORDERED SO THE FOLD IS DETERMINISTIC — by `n.id` ALONE, not by
# `r.captured_at`. `id` is autoincrement, so it is already a total,
# monotonic, insertion order: sorting by it settles every tie a per-player
# fold can face, including two sightings sharing a `captured_at`, without
# needing a second sort key. Ordering on a column from the *joined* table
# (`r.captured_at`) would force SQLite into a TEMP B-TREE sort on the whole
# result; ordering on `n.id`, which leads the `normalized_rows_target_table_idx
# (target_table, id)` index, lets the index itself hand rows back in this
# order — measured on a 300k-row benchmark journal, this removed the `USE
# TEMP B-TREE FOR ORDER BY` step from `EXPLAIN QUERY PLAN` entirely. This is
# NOT "sorted by capture time" — a caller that wants chronological order must
# sort the result itself. One SELECT shape serves every target table: the
# table name is the bound parameter, not part of the string.
SELECT_BY_TARGET_TABLE = """
select n.row_json, r.captured_at
from normalized_rows n
join raw_observations r on r.observation_id = n.observation_id
where n.target_table = ?
order by n.id
"""

#: `ThreadingHTTPServer` (`sidecar.py`) means two searches can land at once.
#: Shared across every fold cache in this package rather than one lock per
#: cache: what it guards in each case is a few dict operations (check, maybe
#: store), never the fold itself — see `cached_fold` — so contention between,
#: say, a tile search and a player search is a handful of microseconds, not a
#: reason to give each projection its own lock.
FOLD_LOCK = threading.Lock()


def journal_file(conn: sqlite3.Connection) -> str:
    """The path this connection is reading, as SQLite itself reports it.

    Asking the connection rather than taking a path argument keeps every
    caller's signature honest: it reads whatever it was handed, and the cache
    key follows from that rather than from something a caller could get wrong
    by passing a different path than the one the connection actually opened.
    """
    for _, name, file in conn.execute("pragma database_list").fetchall():
        if name == "main":
            return str(file)
    return ""


def freshness_key(conn: sqlite3.Connection, target_table: str) -> tuple[int, int]:
    """Cheap stand-in for "has anything changed since the last fold", for one table.

    `(max(id), count(*))` over one target table's rows is a COVERING INDEX read
    against `normalized_rows_target_table_idx (target_table, id)` — measured at
    ~25ms against a 300k-row benchmark journal, two orders of magnitude under
    the multi-second full fold it guards, so running it on every keystroke is
    cheap.

    `JOURNAL.PRUNE()` DOES DELETE FROM `normalized_rows`. The pair still can't
    go stale while looking unchanged: `record()` is INSERT-ONLY (`insert or
    ignore`), `target_table` is fixed at insert time, and `id` is `integer
    primary key autoincrement`, which SQLite never reuses, including after a
    delete. For any one fixed value of `max(id)`, the set of surviving rows at
    or below it can only ever shrink as `prune()` deletes, never grow back —
    the only way `count(*)` rises again is for `max(id)` to rise past it
    first, which means new rows arrived. So the pair can never return to a
    value it held before while the rows behind it differ.
    """
    row = conn.execute(
        "select coalesce(max(id), 0), count(*) from normalized_rows where target_table = ?",
        (target_table,),
    ).fetchone()
    return (int(row[0]), int(row[1]))


def cached_fold[T](
    conn: sqlite3.Connection,
    cache: dict[str, tuple[tuple[int, int], list[T]]],
    target_table: str,
    compute: Callable[[], list[T]],
) -> list[T]:
    """`compute()`, recomputed only when `target_table`'s rows have grown.

    A DESKTOP SEARCH BOX, NOT A REPORT: this exists to sit behind a keystroke,
    and the journal between two keystrokes is overwhelmingly likely to be
    exactly what it was a moment ago. Folding is the expensive step (a full
    scan-and-parse of every sighting for that table), so it is the step this
    caches — the raw read and the fold function themselves stay uncached and
    are still called fresh by anyone using them directly.

    KEYED ON THE FILE, NOT THE CONNECTION. The sidecar opens a fresh
    connection for every request and closes it again, so a cache keyed on the
    connection object would miss every single time while still growing a
    dictionary entry per request that nothing ever removes — a guaranteed
    cache miss on every real search, and an unbounded leak, in the same dict.
    Keying on the file the connection is attached to survives exactly the
    churn that broke the old key (this bug has already shipped here once).
    """
    path = journal_file(conn)
    if not path:
        # AN IN-MEMORY DATABASE REPORTS AN EMPTY FILE PATH. Every `:memory:`
        # connection would then collide on the same `""` key and serve each
        # other's folded list — a test database answering with another
        # test's rows. Skip the cache entirely rather than risk that; the
        # desktop app this cache exists for always reads a real file on disk.
        return compute()

    key = freshness_key(conn, target_table)
    with FOLD_LOCK:
        cached = cache.get(path)
        if cached is not None and cached[0] == key:
            return cached[1]

    # FOLDED OUTSIDE THE LOCK. The fold can run seconds long on a cold cache,
    # and holding the lock across it would serialise every concurrent search
    # behind whichever request got there first. Two requests racing a cold
    # cache can both decide to fold — that duplicates the work, it does not
    # produce a wrong answer, since both are folding the same journal.
    folded = compute()
    with FOLD_LOCK:
        cache[path] = (key, folded)
    return folded
