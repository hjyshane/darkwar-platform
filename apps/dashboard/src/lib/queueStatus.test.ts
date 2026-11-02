import { describe, expect, test } from 'vitest';
import {
  type BeatRow,
  latestPairs,
  minutesToEmpty,
  sendRate,
  snapshotOf,
  tableOf,
} from './queueStatus';

const beat = (at: string, pending: number, sent: number | null, extra = {}): BeatRow => ({
  collector_id: 'c1',
  status: 'sync_backlog',
  outbox_depth: pending,
  reported_at: at,
  details: {
    dead_letters: 4,
    queue: {
      ...(sent === null ? {} : { sent }),
      oldest_pending_at: '2026-11-02T08:00:00Z',
      pending_by_event: { 'snapshot.a': 5, 'snapshot.b': 9 },
      dead_by_error: { timeout: 3 },
      ...extra,
    },
  },
});

describe('snapshotOf', () => {
  test('reads the counts and the breakdowns, biggest first', () => {
    const s = snapshotOf(beat('2026-11-02T10:00:00Z', 14, 1000));
    expect(s).toMatchObject({ pending: 14, deadLetters: 4, sent: 1000 });
    expect(s.pendingByEvent).toEqual([
      ['snapshot.b', 9],
      ['snapshot.a', 5],
    ]);
    expect(s.deadByError).toEqual([['timeout', 3]]);
  });

  test('a beat from an older collector says nothing it does not know', () => {
    const s = snapshotOf({
      collector_id: 'c1',
      status: 'healthy',
      outbox_depth: 3,
      details: { dead_letters: 0 },
      reported_at: '2026-11-02T10:00:00Z',
    });
    expect(s.sent).toBeNull();
    expect(s.oldestPendingAt).toBeNull();
    expect(s.pendingByEvent).toEqual([]);
  });

  test('details that are not an object are tolerated', () => {
    const s = snapshotOf({ ...beat('2026-11-02T10:00:00Z', 1, 1), details: null });
    expect(s.deadLetters).toBe(0);
  });
});

describe('latestPairs', () => {
  test('the newest beat and the newest one five minutes or more older', () => {
    const beats = [
      beat('2026-11-02T10:00:00Z', 10, 100),
      beat('2026-11-02T09:59:30Z', 11, 90),
      beat('2026-11-02T09:50:00Z', 20, 50),
    ];
    const pair = latestPairs(beats).get('c1');
    expect(pair?.now.reported_at).toBe('2026-11-02T10:00:00Z');
    expect(pair?.before?.reported_at).toBe('2026-11-02T09:50:00Z');
  });
});

describe('rates', () => {
  const before = snapshotOf(beat('2026-11-02T09:50:00Z', 200, 1000));
  const now = snapshotOf(beat('2026-11-02T10:00:00Z', 100, 1600));

  test('rows sent per minute', () => {
    expect(sendRate(now, before)).toBe(60);
  });

  test('minutes to empty from how fast the queue is shrinking', () => {
    expect(minutesToEmpty(now, before)).toBe(10);
  });

  test('a queue that is growing has no time to empty', () => {
    const growing = snapshotOf(beat('2026-11-02T10:00:00Z', 300, 1600));
    expect(minutesToEmpty(growing, before)).toBeNull();
  });

  test('without an earlier beat nothing is claimed', () => {
    expect(sendRate(now, null)).toBeNull();
    expect(minutesToEmpty(now, null)).toBeNull();
  });
});

describe('tableOf', () => {
  test('drops the snapshot prefix', () => {
    expect(tableOf('snapshot.arena_entries')).toBe('arena_entries');
    expect(tableOf('other')).toBe('other');
  });
});
