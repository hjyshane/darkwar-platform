"""What the captures we already hold could backfill, per member.

Asked for on 2026-10-02, after the participation report (0204) shipped five
events nobody has captured: before anyone captures them, find out whether
something already in a journal or a discovery pcap carries them — a payload
with a list of OUR members' uids in it, a mail type nobody has looked at, a
string that names the event.

READ ONLY, and on purpose. The journal is opened with `mode=ro`, never through
`Journal`, whose `init_db` creates tables and builds indexes — on a live.db
that grows ~1 GB a day, the first index build is minutes of a locked file
while dw-capture is writing to it.

ONE PASS. `raw_observations` has no index on `source_command`, so asking for
one command at a time would scan the whole file once per command. Instead
every row is read once: commands with a parser are only counted (their history
is already in Supabase); commands without one, and mail, are decoded and
walked; `al.rank` is kept just long enough to know who our members are.

WHAT COUNTS AS A LEAD. A list whose elements carry a uid, and how many of those
uids belong to the alliance's current roster. A board of 149 players with 60 of
ours on it is a per-member source; a list of 20 uids with none of ours is not.
Uids are kept per list and matched against the roster at the end, because the
roster's own al.rank can come later in the stream than the list it judges.

The report names uids by count only. Samples, if asked for, are raw payloads
and stay wherever --samples-dir points: outside the repo, like every other data
artifact (CLAUDE.md, "Secrets").
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import registry
from dw_collector.models import json_default

# Commands whose payload is a mail or a page of mails. Each mail is judged on
# its own, under "mail:type=N", because a mail type is a separate source: 147
# is Black Gold and promoted, every other type is unknown.
MAIL_COMMANDS = frozenset({"chat.get.system.mails", "push.mail", "mail.read.share"})

ROSTER_COMMAND = "al.rank"

# The game's uids are numeric strings: home server in the trailing six digits
# (D-1), sixteen digits in practice. Ten is the floor so that a score or a
# timestamp in a key that happens to end in "uid" is not taken for one.
_UID_VALUE = re.compile(r"^\d{10,20}$")

# Event names as an officer types them and as a localisation key might spell
# them. A hit is a pointer to look at, not evidence of anything.
DEFAULT_KEYWORDS = (
    "capital",
    "clash",
    "throne",
    "king",
    "president",
    "svs",
    "frank",
    "ice",
    "pit",
    "furnace",
    "fury",
    "boss",
    "siege",
    "fortress",
    "zombie",
    "수도",
    "서버전",
    "보스",
)

# A uid set this large is a whole server's map, not a participant list, and
# holding it in memory per list buys nothing. Overflow is counted, not kept.
_MAX_UIDS_PER_LIST = 20_000

# Strings longer than this are not scanned for keywords: they are encoded
# blobs (b64 lineups, protobuf), and a keyword "found" in base64 is noise.
_MAX_KEYWORD_STRING = 2_000


def _is_uid_key(key: str) -> bool:
    lowered = key.lower()
    return lowered.endswith("uid") or lowered in {"userid", "playerid", "memberid"}


def _uid_of(key: str, value: Any) -> str | None:
    if not _is_uid_key(key):
        return None
    if isinstance(value, bool):
        return None
    text = str(value) if isinstance(value, int | str) else None
    return text if text is not None and _UID_VALUE.match(text) else None


def _maybe_json(value: str) -> Any:
    """Mail bodies arrive as JSON inside a string (`contentsLocal`)."""
    stripped = value.lstrip()
    if not stripped or stripped[0] not in "{[":
        return None
    try:
        return json.loads(stripped)
    except ValueError:
        return None


@dataclass
class ListStat:
    """One list in a payload, by path, across every payload of its source."""

    max_len: int = 0
    seen: int = 0
    keys: Counter[str] = field(default_factory=Counter)
    uids: set[str] = field(default_factory=set)
    uid_overflow: bool = False


@dataclass
class SourceStat:
    """One command, or one mail type, across everything scanned."""

    name: str
    known: bool
    count: int = 0
    analysed: int = 0
    bytes: int = 0
    first: datetime | None = None
    last: datetime | None = None
    lists: dict[str, ListStat] = field(default_factory=dict)
    uids: set[str] = field(default_factory=set)
    keywords: Counter[str] = field(default_factory=Counter)
    samples: list[tuple[datetime, str]] = field(default_factory=list)

    def note_time(self, at: datetime) -> None:
        if self.first is None or at < self.first:
            self.first = at
        if self.last is None or at > self.last:
            self.last = at


@dataclass(frozen=True)
class Lead:
    """A source as the report ranks it: by how many of our members it names."""

    source: SourceStat
    members_named: int
    best_path: str | None
    best_path_members: int
    best_path_len: int


class Survey:
    def __init__(
        self,
        *,
        keywords: Iterable[str] = DEFAULT_KEYWORDS,
        max_per_source: int = 2_000,
        samples_per_source: int = 0,
    ) -> None:
        self.keywords = tuple(k.lower() for k in keywords)
        self.max_per_source = max_per_source
        self.samples_per_source = samples_per_source
        self.sources: dict[str, SourceStat] = {}
        # allianceId → (newest captured_at, member uids, observations)
        self._rosters: dict[str, tuple[datetime, frozenset[str], int]] = {}
        self._mails_seen: set[str] = set()
        self.scanned = 0

    # ------------------------------------------------------------- intake

    def add(self, command: str, captured_at: datetime, payload_json: str) -> None:
        """One raw observation. Decodes only what is worth decoding."""
        self.scanned += 1
        if command == ROSTER_COMMAND:
            self._add_roster(captured_at, payload_json)
        if command in MAIL_COMMANDS:
            self._add_mails(command, captured_at, payload_json)
            return
        known = registry.get(command) is not None
        stat = self._source(command, known)
        stat.count += 1
        stat.bytes += len(payload_json)
        stat.note_time(captured_at)
        if known or stat.analysed >= self.max_per_source:
            return
        try:
            payload = json.loads(payload_json)
        except ValueError:
            return
        self._analyse(stat, payload)
        self._keep_sample(stat, captured_at, payload_json)

    def _source(self, name: str, known: bool) -> SourceStat:
        stat = self.sources.get(name)
        if stat is None:
            stat = SourceStat(name=name, known=known)
            self.sources[name] = stat
        return stat

    def _add_roster(self, captured_at: datetime, payload_json: str) -> None:
        try:
            payload = json.loads(payload_json)
        except ValueError:
            return
        alliance = payload.get("allianceId") if isinstance(payload, dict) else None
        members = payload.get("list") if isinstance(payload, dict) else None
        if not isinstance(alliance, str) or not isinstance(members, list):
            return
        uids = frozenset(
            str(m["uid"]) for m in members if isinstance(m, dict) and m.get("uid") is not None
        )
        held = self._rosters.get(alliance)
        count = (held[2] if held else 0) + 1
        if held is None or captured_at >= held[0]:
            self._rosters[alliance] = (captured_at, uids, count)
        else:
            self._rosters[alliance] = (held[0], held[1], count)

    def _add_mails(self, command: str, captured_at: datetime, payload_json: str) -> None:
        try:
            payload = json.loads(payload_json)
        except ValueError:
            return
        if not isinstance(payload, dict):
            return
        if command == "chat.get.system.mails":
            raw = payload.get("msg")
            mails = [m for m in raw if isinstance(m, dict)] if isinstance(raw, list) else []
        else:
            mails = [payload]
        for mail in mails:
            mail_uid = mail.get("uid")
            # The inbox is paged and re-read; a mail on three pages is one mail.
            if mail_uid is not None:
                key = f"{command}:{mail_uid}"
                if key in self._mails_seen:
                    continue
                self._mails_seen.add(key)
            kind = mail.get("type", "?")
            other = mail.get("otherType")
            name = f"mail:type={kind}" + (f"/otherType={other}" if other is not None else "")
            # 147 is the Black Gold report, the one mail type with a parser.
            stat = self._source(name, known=kind == 147)
            stat.count += 1
            text = json.dumps(mail, sort_keys=True, default=json_default)
            stat.bytes += len(text)
            stat.note_time(captured_at)
            if stat.analysed >= self.max_per_source:
                continue
            self._analyse(stat, mail)
            self._keep_sample(stat, captured_at, text)

    def _keep_sample(self, stat: SourceStat, captured_at: datetime, text: str) -> None:
        if self.samples_per_source <= 0:
            return
        stat.samples.append((captured_at, text))
        # The newest few: the shape that is current, not the first ever seen.
        stat.samples.sort(key=lambda sample: sample[0])
        del stat.samples[: -self.samples_per_source]

    # ------------------------------------------------------------ walking

    def _analyse(self, stat: SourceStat, payload: Any) -> None:
        stat.analysed += 1
        self._walk(stat, payload, "$")

    def _walk(self, stat: SourceStat, value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                uid = _uid_of(str(key), item)
                if uid is not None:
                    stat.uids.add(uid)
                self._walk(stat, item, f"{path}.{key}")
        elif isinstance(value, list):
            self._walk_list(stat, value, path)
        elif isinstance(value, str):
            nested = _maybe_json(value)
            if nested is not None:
                self._walk(stat, nested, f"{path}{{json}}")
            elif len(value) <= _MAX_KEYWORD_STRING:
                lowered = value.lower()
                for keyword in self.keywords:
                    if keyword in lowered:
                        stat.keywords[keyword] += 1

    def _walk_list(self, stat: SourceStat, items: list[Any], path: str) -> None:
        list_path = f"{path}[]"
        entry = stat.lists.get(list_path)
        if entry is None:
            entry = ListStat()
            stat.lists[list_path] = entry
        entry.seen += 1
        entry.max_len = max(entry.max_len, len(items))
        for item in items:
            if isinstance(item, dict):
                entry.keys.update(str(k) for k in item)
                for key, inner in item.items():
                    uid = _uid_of(str(key), inner)
                    if uid is None:
                        continue
                    if len(entry.uids) < _MAX_UIDS_PER_LIST:
                        entry.uids.add(uid)
                    else:
                        entry.uid_overflow = True
            self._walk(stat, item, list_path)

    # ------------------------------------------------------------ results

    def roster(
        self, alliance_id: str | None = None
    ) -> tuple[str | None, frozenset[str], datetime | None]:
        """The roster leads are judged against: the alliance asked for, else
        the one with the most al.rank readings — the collector's own, since
        that is the roster it opens most."""
        if not self._rosters:
            return None, frozenset(), None
        if alliance_id is None:
            alliance_id = max(self._rosters, key=lambda a: self._rosters[a][2])
        held = self._rosters.get(alliance_id)
        if held is None:
            return alliance_id, frozenset(), None
        return alliance_id, held[1], held[0]

    def leads(self, roster: frozenset[str]) -> list[Lead]:
        """Every source without a parser, most of our members named first."""
        found: list[Lead] = []
        for stat in self.sources.values():
            if stat.known:
                continue
            best_path: str | None = None
            best_members = best_len = 0
            for path, entry in stat.lists.items():
                members = len(entry.uids & roster)
                if (members, entry.max_len) > (best_members, best_len):
                    best_path, best_members, best_len = path, members, entry.max_len
            found.append(
                Lead(
                    source=stat,
                    members_named=len(stat.uids & roster),
                    best_path=best_path,
                    best_path_members=best_members,
                    best_path_len=best_len,
                )
            )
        found.sort(key=lambda lead: (-lead.members_named, -lead.best_path_len, lead.source.name))
        return found


# ---------------------------------------------------------------- sources


def iter_journal(path: Path) -> Iterator[tuple[str, datetime, str]]:
    """Every raw observation in a journal, oldest row first, opened read-only."""
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        cursor = conn.execute(
            "select source_command, captured_at, payload_json from raw_observations order by rowid"
        )
        for command, captured_at, payload_json in cursor:
            yield str(command), datetime.fromisoformat(str(captured_at)), str(payload_json)
    finally:
        conn.close()


def capture_files(paths: Iterable[Path]) -> list[Path]:
    """Files as given; directories expanded to the captures inside them."""
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(sorted(p for p in path.iterdir() if p.suffix in {".pcap", ".pcapng"}))
        else:
            files.append(path)
    return files


def iter_capture(path: Path, port: int) -> Iterator[tuple[str, datetime, str]]:
    """Inbound responses in one capture, decoded by the collector's own
    decoder — the same one scan-capture uses, so the survey and the pipeline
    cannot disagree about what a packet said."""
    from dw_collector.protocol.pcapng import iter_extension_events

    fallback = datetime.fromtimestamp(path.stat().st_mtime).astimezone()
    for event in iter_extension_events(path, port=port):
        if event.direction != "inbound":
            continue
        text = json.dumps(dict(event.payload), sort_keys=True, default=json_default)
        yield event.command, event.captured_at or fallback, text


# ----------------------------------------------------------------- report


def _when(at: datetime | None) -> str:
    return "—" if at is None else at.strftime("%Y-%m-%d %H:%M")


def _top_keys(entry: ListStat, limit: int = 8) -> str:
    return ", ".join(key for key, _ in entry.keys.most_common(limit))


def render_report(
    survey: Survey,
    *,
    inputs: list[str],
    alliance_id: str | None = None,
    lead_threshold: int = 5,
) -> str:
    alliance, roster, roster_at = survey.roster(alliance_id)
    leads = survey.leads(roster)
    lines: list[str] = [
        "# Backfill survey",
        "",
        f"Scanned {survey.scanned:,} observations from: " + ", ".join(inputs),
        "",
        f"Roster: alliance `{alliance}`, {len(roster)} members, al.rank of {_when(roster_at)}."
        if roster
        else "Roster: **no al.rank found** — member counts below are all 0. Pass a journal "
        "that holds an al.rank reading, or --alliance-id.",
        "",
        f"A LEAD is a source without a parser whose single list names at least "
        f"{lead_threshold} of our members. Uids are counted, never printed.",
        "",
        "## Leads and other sources without a parser",
        "",
        "| source | seen | first | last | our members named | best list | in it | list len "
        "| keys | keywords |",
        "|---|---:|---|---|---:|---|---:|---:|---|---|",
    ]
    for lead in leads:
        stat = lead.source
        entry = stat.lists.get(lead.best_path) if lead.best_path else None
        flag = "**LEAD** " if lead.best_path_members >= lead_threshold else ""
        lines.append(
            f"| {flag}`{stat.name}` | {stat.count:,} | {_when(stat.first)} | {_when(stat.last)} "
            f"| {lead.members_named} | `{lead.best_path or '—'}` | {lead.best_path_members} "
            f"| {lead.best_path_len} | {_top_keys(entry) if entry else ''} "
            f"| {', '.join(f'{k} x{n}' for k, n in stat.keywords.most_common(6))} |"
        )
    if not leads:
        lines.append("| — | | | | | | | | | |")

    lines += [
        "",
        "## Sources with a parser (counted only — their history is already promoted)",
        "",
        "How far back each one goes is how far a renormalize or backfill could reach.",
        "",
        "| source | seen | first | last | MB |",
        "|---|---:|---|---|---:|",
    ]
    for stat in sorted(
        (s for s in survey.sources.values() if s.known), key=lambda s: (-s.count, s.name)
    ):
        lines.append(
            f"| `{stat.name}` | {stat.count:,} | {_when(stat.first)} | {_when(stat.last)} "
            f"| {stat.bytes / 1_000_000:.1f} |"
        )
    lines.append("")
    return "\n".join(lines)


def write_samples(survey: Survey, directory: Path) -> int:
    """The newest few raw payloads per source without a parser. Raw: names
    and uids included. Never inside the repo."""
    directory.mkdir(parents=True, exist_ok=True)
    written = 0
    for stat in survey.sources.values():
        if stat.known or not stat.samples:
            continue
        safe = re.sub(r"[^A-Za-z0-9._=-]+", "_", stat.name)
        for index, (at, text) in enumerate(stat.samples):
            target = directory / f"{safe}.{index}.json"
            body = {"source": stat.name, "captured_at": at.isoformat(), "payload": json.loads(text)}
            target.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
            written += 1
    return written
