import { expect, test } from 'vitest';
import {
  type HistoryRow,
  collapseHistory,
  delta,
  observedOnlineState,
} from '../src/lib/memberHistory';

function row(over: Partial<HistoryRow> & { snapshot_id: string }): HistoryRow {
  return {
    captured_at: '2026-08-01T00:00:00Z',
    power: 100,
    kills: 10,
    member_rank: 3,
    presence_redacted: false,
    online_state: 'offline',
    ...over,
  };
}

test('a run of identical captures collapses to the first of the run', () => {
  const kept = collapseHistory([
    row({ snapshot_id: 'a' }),
    row({ snapshot_id: 'b' }),
    row({ snapshot_id: 'c' }),
  ]);
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a']);
});

test('the kept row is when the value became what it is, not when it was last confirmed', () => {
  const kept = collapseHistory([
    row({ snapshot_id: 'a', power: 100 }),
    row({ snapshot_id: 'b', power: 200 }),
    row({ snapshot_id: 'c', power: 200 }),
    row({ snapshot_id: 'd', power: 200 }),
  ]);
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a', 'b']);
});

test('a value that returns to an earlier one is still a change', () => {
  // Only CONSECUTIVE rows are compared. Power going 100 → 200 → 100 is two
  // events; deduping against everything seen would hide the second.
  const kept = collapseHistory([
    row({ snapshot_id: 'a', power: 100 }),
    row({ snapshot_id: 'b', power: 200 }),
    row({ snapshot_id: 'c', power: 100 }),
  ]);
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a', 'b', 'c']);
});

test('every watched field can trigger a row', () => {
  for (const change of [
    { power: 999 },
    { kills: 999 },
    { member_rank: 5 },
    { online_state: 'online' },
  ]) {
    const kept = collapseHistory([row({ snapshot_id: 'a' }), row({ snapshot_id: 'b', ...change })]);
    expect(kept.map((r) => r.snapshot_id)).toEqual(['a', 'b']);
  }
});

test('presence from a redacted capture is not an observation', () => {
  // The game reports everyone online with offLineTime 0 to a viewer outside
  // the alliance. Taking that at face value would invent a "came online".
  expect(observedOnlineState(row({ snapshot_id: 'a', presence_redacted: true }))).toBeNull();
  expect(
    observedOnlineState(row({ snapshot_id: 'a', presence_redacted: true, online_state: 'online' })),
  ).toBeNull();
  expect(observedOnlineState(row({ snapshot_id: 'a', online_state: 'online' }))).toBe('online');
});

test('a redacted capture does not manufacture a presence change', () => {
  // Same player, same power. The only difference is who was capturing, and
  // that is not an event in this member's history.
  const kept = collapseHistory([
    row({ snapshot_id: 'a', presence_redacted: true, online_state: 'online' }),
    row({ snapshot_id: 'b', presence_redacted: true, online_state: 'online' }),
  ]);
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a']);
});

test('going from redacted to actually observed IS a change', () => {
  // Unknown becoming known is worth a row: it is the first time anybody saw
  // this member's presence.
  const kept = collapseHistory([
    row({ snapshot_id: 'a', presence_redacted: true, online_state: 'online' }),
    row({ snapshot_id: 'b', presence_redacted: false, online_state: 'online' }),
  ]);
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a', 'b']);
});

test('an unobserved figure stays unobserved rather than collapsing to zero', () => {
  const kept = collapseHistory([
    row({ snapshot_id: 'a', power: null }),
    row({ snapshot_id: 'b', power: null }),
    row({ snapshot_id: 'c', power: 0 }),
  ]);
  // null → null is unchanged; null → 0 is a change, because a measured zero
  // is not the same as never having measured.
  expect(kept.map((r) => r.snapshot_id)).toEqual(['a', 'c']);
});

test('nothing in, nothing out', () => {
  expect(collapseHistory([])).toEqual([]);
});

test('a delta against an unobserved reading is unknown, not zero', () => {
  expect(delta(120, 100)).toBe(20);
  expect(delta(100, 120)).toBe(-20);
  expect(delta(100, null)).toBeNull();
  expect(delta(null, 100)).toBeNull();
  expect(delta(0, 0)).toBe(0);
});
