import { describe, expect, it } from 'vitest';
import { type CalendarEvent, arrange, bucketOf, labelOf, until } from './data';

const NOW = new Date('2026-10-02T21:40:00Z');

function event(
  id: string,
  starts: string | null,
  ends: string | null,
  name: string | null = null,
): CalendarEvent {
  return {
    server_id: 580,
    activity_id: id,
    name,
    starts_at: starts,
    ends_at: ends,
    need_hq_level: 10,
    sub_type: null,
    seen_at: '2026-10-02T21:40:09Z',
  };
}

describe('bucketOf', () => {
  it('puts a running event in live', () => {
    expect(bucketOf(event('1', '2026-10-01T02:00:00Z', '2026-10-04T02:00:00Z'), NOW)).toBe('live');
  });

  it('puts a future event in upcoming', () => {
    expect(bucketOf(event('2', '2026-10-05T02:00:00Z', '2026-10-12T02:00:00Z'), NOW)).toBe(
      'upcoming',
    );
  });

  it('puts a finished event in ended', () => {
    expect(bucketOf(event('3', '2026-09-29T02:00:00Z', '2026-10-02T02:00:00Z'), NOW)).toBe('ended');
  });

  it('treats an event that runs half a year or more as a standing feature, not live', () => {
    // The login lists permanent features ending in 2044.
    expect(bucketOf(event('4', '2026-04-04T02:00:00Z', '2044-03-30T12:39:00Z'), NOW)).toBe(
      'standing',
    );
  });

  it('keeps an event without times apart', () => {
    expect(bucketOf(event('5', null, null), NOW)).toBe('untimed');
  });
});

describe('arrange', () => {
  it('orders live by soonest end and upcoming by soonest start', () => {
    const out = arrange(
      [
        event('a', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z'),
        event('b', '2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z'),
        event('c', '2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z'),
        event('d', '2026-10-04T00:00:00Z', '2026-10-06T00:00:00Z'),
      ],
      NOW,
    );
    expect(out.live.map((e) => e.activity_id)).toEqual(['b', 'a']);
    expect(out.upcoming.map((e) => e.activity_id)).toEqual(['d', 'c']);
  });

  it('orders standing features by numeric id', () => {
    const far = '2044-01-01T00:00:00Z';
    const out = arrange(
      [event('40086', '2026-04-04T00:00:00Z', far), event('8072', '2025-03-26T00:00:00Z', far)],
      NOW,
    );
    expect(out.standing.map((e) => e.activity_id)).toEqual(['8072', '40086']);
  });
});

describe('until', () => {
  it('shows days and hours past a day', () => {
    expect(until('2026-10-04T23:40:00Z', NOW)).toBe('2d 2h');
  });

  it('shows hours and minutes under a day', () => {
    expect(until('2026-10-03T02:00:00Z', NOW)).toBe('4h 20m');
  });

  it('never goes negative', () => {
    expect(until('2026-10-01T00:00:00Z', NOW)).toBe('0m');
  });
});

describe('labelOf', () => {
  it('uses the name people gave it', () => {
    expect(labelOf({ name: 'Ice Pit', activity_id: '41101' })).toBe('Ice Pit');
  });

  it('falls back to the id', () => {
    expect(labelOf({ name: null, activity_id: '41101' })).toBe('Event #41101');
  });
});
