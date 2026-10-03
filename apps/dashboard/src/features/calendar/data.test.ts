import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  type Category,
  arrange,
  bucketOf,
  byServerDay,
  inCategory,
  labelOf,
  lastServerDay,
  runsOn,
  search,
  serverDay,
  serverWhen,
  until,
} from './data';

const NOW = new Date('2026-10-02T21:40:00Z');

function event(
  id: string,
  starts: string | null,
  ends: string | null,
  name: string | null = null,
  category: Category | null = null,
): CalendarEvent {
  return {
    server_id: 580,
    activity_id: id,
    name,
    category,
    activity_type: null,
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

  it('treats an event that runs half a year or more as a standing feature', () => {
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
});

describe('server time (UTC−2)', () => {
  it('puts 01:00 UTC on the previous server day', () => {
    expect(serverDay('2026-10-03T01:00:00Z')).toBe('2026-10-02');
    expect(serverDay('2026-10-03T02:00:00Z')).toBe('2026-10-03');
  });

  it('prints the server clock, not the reader clock', () => {
    expect(serverWhen('2026-10-03T14:00:00Z', NOW)).toBe('Oct 3 · 12:00');
  });

  it('adds the year when it is not this one', () => {
    expect(serverWhen('2044-04-11T05:14:00Z', NOW)).toBe('Apr 11, 2044 · 03:14');
  });

  it('counts an end at server midnight as the day before', () => {
    // 02:00 UTC is 00:00 server time: the event is over when the 5th begins.
    expect(lastServerDay('2026-10-05T02:00:00Z')).toBe('2026-10-04');
  });
});

describe('until', () => {
  it('shows days and hours past a day', () => {
    expect(until('2026-10-04T23:40:00Z', NOW)).toBe('2d 2h');
  });

  it('never goes negative', () => {
    expect(until('2026-10-01T00:00:00Z', NOW)).toBe('0m');
  });
});

describe('labelOf', () => {
  it('falls back to the id', () => {
    expect(labelOf({ name: null, activity_id: '41101' })).toBe('Event #41101');
  });
});

describe('categories', () => {
  it('shows unclassified entries with the events', () => {
    expect(inCategory(event('1', null, null), 'event')).toBe(true);
    expect(inCategory(event('1', null, null), 'shop')).toBe(false);
  });

  it('keeps shops out of events and in shop', () => {
    const pack = event('300004', null, null, 'Mod Vehicle Combo Pack', 'shop');
    expect(inCategory(pack, 'event')).toBe(false);
    expect(inCategory(pack, 'shop')).toBe(true);
    expect(inCategory(pack, 'all')).toBe(true);
  });
});

describe('search', () => {
  const ice = event('41101', '2026-08-17T02:00:00Z', '2026-10-20T02:00:00Z', 'Arctic Ice Pit');
  const clash = event('111001', '2026-10-03T14:00:00Z', '2026-10-05T02:00:00Z', 'Capital Clash');
  const pack = event(
    '300004',
    '2026-10-01T02:00:00Z',
    '2026-10-04T02:00:00Z',
    'Combo Pack',
    'shop',
  );
  const all = [ice, clash, pack];

  it('finds by part of the name, any case', () => {
    expect(search(all, { text: 'capital', day: '', category: 'all' })).toEqual([clash]);
  });

  it('finds by id', () => {
    expect(search(all, { text: '41101', day: '', category: 'all' })).toEqual([ice]);
  });

  it('lists what runs on a server day', () => {
    expect(search(all, { text: '', day: '2026-10-04', category: 'event' })).toEqual([ice, clash]);
    // Capital Clash's end at 02:00 UTC is midnight server time: not on the 5th.
    expect(runsOn(clash, '2026-10-05')).toBe(false);
  });

  it('applies the category with the rest', () => {
    expect(search(all, { text: '', day: '2026-10-02', category: 'shop' })).toEqual([pack]);
  });
});

describe('byServerDay', () => {
  it('files starts and last days by server day and leaves standing features off', () => {
    const { starts, ends } = byServerDay([
      event('111001', '2026-10-03T14:00:00Z', '2026-10-05T02:00:00Z', 'Capital Clash'),
      event('8072', '2025-03-26T02:00:00Z', '2044-03-30T12:39:00Z', 'Customized Gift'),
    ]);
    expect(starts.get('2026-10-03')?.map((e) => e.activity_id)).toEqual(['111001']);
    expect(ends.get('2026-10-04')?.map((e) => e.activity_id)).toEqual(['111001']);
    expect([...starts.keys()]).toEqual(['2026-10-03']);
  });
});
