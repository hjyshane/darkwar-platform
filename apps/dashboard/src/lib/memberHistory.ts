// The roster snapshot timeline for one member.
//
// Two rules, both of which exist because the raw table is not the history:
//
// 1. A capture every half hour that says the same thing is not an event.
//    Two hundred identical rows are noise the reader has to scroll past to
//    find the three that matter, so a run of unchanged captures collapses to
//    the first of the run — the moment the value became what it is.
//
// 2. A redacted snapshot's presence is not an observation. The game reports
//    everyone as online with offLineTime 0 when the viewer is outside the
//    alliance (0024's comment on offline_since says so), which means
//    `online_state` from such a capture is an artefact. Comparing it would
//    manufacture "came online" events out of who happened to be capturing,
//    and displaying it would assert something nobody saw (FR-CORE-003,
//    FR-UI-008).

export interface HistoryRow {
  snapshot_id: string;
  captured_at: string;
  power: number | null;
  kills: number | null;
  member_rank: number | null;
  presence_redacted: boolean;
  online_state: string | null;
}

/** Presence as actually observed, or null when the capture could not see it.
 *
 * Null here means unknown, which is why it must not be rendered as
 * "offline" — the two are the distinction this whole app keeps making. */
export function observedOnlineState(row: HistoryRow): string | null {
  return row.presence_redacted ? null : row.online_state;
}

function unchanged(a: HistoryRow, b: HistoryRow): boolean {
  return (
    a.power === b.power &&
    a.kills === b.kills &&
    a.member_rank === b.member_rank &&
    observedOnlineState(a) === observedOnlineState(b)
  );
}

/** Drop consecutive captures that said nothing new.
 *
 * Takes rows OLDEST first and returns them oldest first. The kept row of a
 * run is the earliest one, because the fact worth recording is when a value
 * changed, not when it was last confirmed unchanged.
 */
export function collapseHistory(rows: readonly HistoryRow[]): HistoryRow[] {
  const kept: HistoryRow[] = [];
  for (const row of rows) {
    const previous = kept[kept.length - 1];
    if (previous === undefined || !unchanged(previous, row)) {
      kept.push(row);
    }
  }
  return kept;
}

/** How a figure moved against the row before it, for a delta column.
 *
 * Null when either side is unobserved. A missing reading is not a zero, so
 * "unchanged" is the one thing this must not say about it (FR-ACT-004).
 */
export function delta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
