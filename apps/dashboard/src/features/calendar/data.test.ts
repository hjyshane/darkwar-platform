import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  type CalendarEvent,
  type Category,
  addDays,
  arrange,
  bucketOf,
  byServerDay,
  changesIn,
  dayBlocks,
  endWithSeason,
  groupedWeekBars,
  inCategory,
  knownCategory,
  labelOf,
  lastServerDay,
  runsOn,
  search,
  serverDay,
  serverWhen,
  until,
  weekBars,
} from './data';

const NOW = new Date('2026-10-02T21:40:00Z');
const EVERY = new Set(CATEGORIES);

function event(
  id: string,
  starts: string | null,
  ends: string | null,
  name: string | null = null,
  category: Category | null = null,
  activityType: number | null = null,
): CalendarEvent {
  return {
    server_id: 580,
    activity_id: id,
    name,
    category,
    activity_type: activityType,
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
    expect(inCategory(event('1', null, null), new Set(['event']))).toBe(true);
    expect(inCategory(event('1', null, null), new Set(['premium']))).toBe(false);
  });

  it('shows a category only while it is picked', () => {
    const pack = event('300004', null, null, 'Mod Vehicle Combo Pack', 'premium');
    expect(inCategory(pack, new Set(['event', 'major']))).toBe(false);
    expect(inCategory(pack, new Set(['premium']))).toBe(true);
  });

  it('reads the old shop category as premium and drops what it does not know', () => {
    expect(knownCategory('shop')).toBe('premium');
    expect(knownCategory('season')).toBe('season');
    expect(knownCategory('gacha')).toBeNull();
    expect(knownCategory(null)).toBeNull();
  });
});

describe('endWithSeason', () => {
  // The finale (Season Celebration, type 131) starts 10-12 00:00 server time.
  const finale = event(
    '104000',
    '2026-10-12T02:00:00Z',
    '2026-11-02T02:00:00Z',
    null,
    'season',
    131,
  );
  const icePit = event(
    '41101',
    '2026-08-17T02:00:00Z',
    '2026-10-20T02:00:00Z',
    null,
    'season',
    126,
  );

  it('cuts a season event off when the finale starts', () => {
    const [cut] = endWithSeason([icePit, finale]);
    expect(cut?.ends_at).toBe('2026-10-12T02:00:00Z');
  });

  it('leaves the finale, the season passes and other categories alone', () => {
    const pass = event('70030', '2026-08-17T02:00:00Z', '2026-10-16T02:00:00Z', null, 'season', 45);
    const clash = event(
      '111001',
      '2026-10-10T14:00:00Z',
      '2026-10-14T02:00:00Z',
      null,
      'major',
      54,
    );
    const out = endWithSeason([finale, pass, clash]);
    expect(out.map((e) => e.ends_at)).toEqual([finale.ends_at, pass.ends_at, clash.ends_at]);
  });

  it('changes nothing when no finale is listed', () => {
    expect(endWithSeason([icePit])).toEqual([icePit]);
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
    'premium',
  );
  const all = [ice, clash, pack];

  it('finds by part of the name, any case', () => {
    expect(search(all, { text: 'capital', day: '', shown: EVERY })).toEqual([clash]);
  });

  it('finds by id', () => {
    expect(search(all, { text: '41101', day: '', shown: EVERY })).toEqual([ice]);
  });

  it('lists what runs on a server day', () => {
    expect(search(all, { text: '', day: '2026-10-04', shown: new Set(['event']) })).toEqual([
      ice,
      clash,
    ]);
    // Capital Clash's end at 02:00 UTC is midnight server time: not on the 5th.
    expect(runsOn(clash, '2026-10-05')).toBe(false);
  });

  it('applies the category with the rest', () => {
    expect(search(all, { text: '', day: '2026-10-02', shown: new Set(['premium']) })).toEqual([
      pack,
    ]);
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

describe('weekBars', () => {
  const week = [
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ];

  it('clips an event to the week and says which ends are real', () => {
    // Runs 09-21 .. 10-01 (ends at 02:00 UTC on 10-02 = midnight server time).
    const [bar] = weekBars([event('a', '2026-09-21T02:00:00Z', '2026-10-02T02:00:00Z')], week);
    expect(bar).toMatchObject({ start: 0, end: 3, startsHere: false, endsHere: true, lane: 0 });
  });

  it('packs bars that do not overlap into one lane and the rest below', () => {
    const bars = weekBars(
      [
        event('long', '2026-09-28T02:00:00Z', '2026-10-05T02:00:00Z'),
        event('mon', '2026-09-28T02:00:00Z', '2026-09-29T02:00:00Z'),
        event('fri', '2026-10-02T02:00:00Z', '2026-10-03T02:00:00Z'),
      ],
      week,
    );
    const lane = Object.fromEntries(bars.map((b) => [b.event.activity_id, b.lane]));
    expect(lane).toEqual({ long: 0, mon: 1, fri: 1 });
  });

  it('leaves out events outside the week and standing features', () => {
    expect(
      weekBars(
        [
          event('later', '2026-10-06T02:00:00Z', '2026-10-08T02:00:00Z'),
          event('forever', '2026-04-04T02:00:00Z', '2044-03-30T12:39:00Z'),
        ],
        week,
      ),
    ).toEqual([]);
  });
});

describe('weekBars ordering', () => {
  it('puts the major fights in the top lane', () => {
    const week = [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ];
    const bars = weekBars(
      [
        event('long', '2026-09-28T02:00:00Z', '2026-10-05T02:00:00Z'),
        event('clash', '2026-10-03T02:00:00Z', '2026-10-04T02:00:00Z', null, 'major'),
      ],
      week,
    );
    expect(bars.find((b) => b.event.activity_id === 'clash')?.lane).toBe(0);
  });
});

describe('groupedWeekBars', () => {
  const week = [
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
  ];

  it('groups by category in filter order, each with its own lanes', () => {
    const groups = groupedWeekBars(
      [
        event('ev', '2026-09-28T02:00:00Z', '2026-10-05T02:00:00Z', null, 'event'),
        event('clash', '2026-10-03T02:00:00Z', '2026-10-04T02:00:00Z', null, 'major'),
        event('duel', '2026-09-28T02:00:00Z', '2026-10-04T02:00:00Z', null, 'recurring'),
        event('ev2', '2026-09-29T02:00:00Z', '2026-09-30T02:00:00Z', null, 'event'),
      ],
      week,
    );
    expect(groups.map((g) => [g.category, g.lanes])).toEqual([
      ['major', 1],
      ['recurring', 1],
      ['event', 2],
    ]);
  });
});

describe('the day in four-hour blocks', () => {
  it('starts at server midnight, 02:00 UTC, and runs six blocks', () => {
    const blocks = dayBlocks('2026-10-03');
    expect(blocks).toHaveLength(6);
    expect(blocks[0]?.from).toBe('2026-10-03T02:00:00.000Z');
    expect(blocks[5]?.to).toBe('2026-10-04T02:00:00.000Z');
  });

  it('lists what starts or ends inside a block, not what runs through it', () => {
    const clash = event('clash', '2026-10-03T14:00:00Z', '2026-10-05T02:00:00Z');
    const through = event('ice', '2026-09-01T02:00:00Z', '2026-10-20T02:00:00Z');
    const pack = event('pack', '2026-10-01T02:00:00Z', '2026-10-03T06:00:00Z');
    // 12:00-16:00 server time is 14:00-18:00 UTC.
    expect(
      changesIn([clash, through, pack], '2026-10-03T14:00:00Z', '2026-10-03T18:00:00Z'),
    ).toEqual([{ event: clash, edge: 'starts' }]);
    // An end exactly at a block's close belongs to that block.
    expect(changesIn([pack], '2026-10-03T02:00:00Z', '2026-10-03T06:00:00Z')).toEqual([
      { event: pack, edge: 'ends' },
    ]);
  });

  it('steps days across a month end', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});
