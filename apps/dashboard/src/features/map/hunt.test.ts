import { describe, expect, it } from 'vitest';
import {
  type Truck,
  huntStrip,
  isWorthTaking,
  lootsLeft,
  missionFromRow,
  missionIsOpen,
  pointToCoordinate,
  timeLeft,
  truckFromRow,
  truckPosition,
} from './hunt';

const NOW = new Date('2026-10-09T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function truck(over: Partial<Truck> = {}): Truck {
  return {
    truckUuid: '1',
    serverId: 580,
    ownerName: 'Hauler',
    allianceAbbr: 'EXMP',
    quality: 5,
    heroFragments: 1,
    robTimes: 0,
    arriveAt: at(90),
    leg: null,
    positionSeenAt: null,
    cargoSeenAt: NOW,
    ...over,
  };
}

describe('pointToCoordinate', () => {
  it('unpacks the game point the way the collector does: row first, column one-based', () => {
    expect(pointToCoordinate(393447)).toEqual({ x: 446, y: 393 });
    expect(pointToCoordinate(1001)).toEqual({ x: 0, y: 1 });
  });
});

describe('isWorthTaking', () => {
  it('wants an orange truck carrying a hero fragment that is still on the road', () => {
    expect(isWorthTaking(truck(), NOW)).toBe(true);
    expect(isWorthTaking(truck({ quality: 4 }), NOW)).toBe(true);
  });

  it('turns down a truck without a hero fragment, however good it is', () => {
    expect(isWorthTaking(truck({ heroFragments: 0 }), NOW)).toBe(false);
  });

  it('turns down a low-quality truck even if it somehow carries one', () => {
    expect(isWorthTaking(truck({ quality: 3 }), NOW)).toBe(false);
  });

  it('turns down a truck that has arrived, or has been looted twice', () => {
    expect(isWorthTaking(truck({ arriveAt: at(-1) }), NOW)).toBe(false);
    expect(isWorthTaking(truck({ robTimes: 2 }), NOW)).toBe(false);
  });
});

describe('lootsLeft', () => {
  it('counts down from two and treats an unread count as untouched', () => {
    expect(lootsLeft({ robTimes: 0 })).toBe(2);
    expect(lootsLeft({ robTimes: 1 })).toBe(1);
    expect(lootsLeft({ robTimes: 5 })).toBe(0);
    expect(lootsLeft({ robTimes: null })).toBe(2);
  });
});

describe('truckPosition', () => {
  const leg = {
    from: { x: 100, y: 100 },
    to: { x: 200, y: 300 },
    startAt: at(-5),
    endAt: at(5),
  };

  it('is halfway along the leg halfway through it', () => {
    expect(truckPosition({ leg }, NOW)).toEqual({ at: { x: 150, y: 200 }, live: true });
  });

  it('is at the end of the leg once it is over, and says it is no longer live', () => {
    expect(truckPosition({ leg }, at(30))).toEqual({ at: { x: 200, y: 300 }, live: false });
  });

  it('is at the start before the leg begins', () => {
    expect(truckPosition({ leg }, at(-60))?.at).toEqual({ x: 100, y: 100 });
  });

  it('has no position without a leg', () => {
    expect(truckPosition({ leg: null }, NOW)).toBeNull();
  });
});

describe('timeLeft', () => {
  it('words minutes and hours, and says when it is gone', () => {
    expect(timeLeft(at(72), NOW)).toBe('1h 12m');
    expect(timeLeft(at(125), NOW)).toBe('2h 05m');
    expect(timeLeft(at(9), NOW)).toBe('9m');
    expect(timeLeft(new Date(NOW.getTime() + 20_000), NOW)).toBe('under a minute');
    expect(timeLeft(at(-1), NOW)).toBe('gone');
  });
});

describe('rows from the views', () => {
  const row = {
    truck_uuid: '777',
    server_id: 580,
    owner_name: 'Hauler',
    alliance_abbr: 'EXMP',
    quality: 5,
    hero_fragments: 1,
    rob_times: 1,
    arrive_at: '2026-10-09T13:30:00Z',
    start_pos: 393447,
    target_pos: 485422,
    segment_start_at: '2026-10-09T11:55:00Z',
    segment_end_at: '2026-10-09T12:05:00Z',
    position_seen_at: '2026-10-09T11:56:00Z',
    cargo_seen_at: '2026-10-09T11:50:00Z',
  };

  it('builds a truck with its leg', () => {
    const built = truckFromRow(row);

    expect(built?.leg?.from).toEqual({ x: 446, y: 393 });
    expect(built?.leg?.to).toEqual({ x: 421, y: 485 });
    expect(built?.heroFragments).toBe(1);
  });

  it('builds a truck without a position when the march was never seen', () => {
    const built = truckFromRow({ ...row, start_pos: null, segment_end_at: null });

    expect(built).not.toBeNull();
    expect(built?.leg).toBeNull();
  });

  it('drops a row that lacks what the rules need', () => {
    expect(truckFromRow({ ...row, quality: null })).toBeNull();
    expect(truckFromRow({ ...row, arrive_at: null })).toBeNull();
  });

  it('builds a mission and drops one with no place or no end', () => {
    const mission = {
      mission_uuid: 'm1',
      server_id: 580,
      x: 446,
      y: 393,
      owner_name: 'Owner',
      alliance_abbr: 'EXMP',
      orange_books: 6,
      steal_max: 3,
      ends_at: '2026-10-09T14:00:00Z',
    };

    expect(missionFromRow(mission)?.orangeBooks).toBe(6);
    expect(missionFromRow({ ...mission, x: null })).toBeNull();
    expect(missionFromRow({ ...mission, ends_at: null })).toBeNull();
    expect(missionIsOpen({ endsAt: at(1) }, NOW)).toBe(true);
    expect(missionIsOpen({ endsAt: at(-1) }, NOW)).toBe(false);
  });
});

describe('huntStrip', () => {
  it('counts what is there and says how many could be placed', () => {
    const cells = huntStrip({ serverId: 580, trucks: 3, placed: 1, missions: 1 });

    expect(cells.map((c) => c.value)).toEqual(['580', '3 trucks', '1 mission']);
    expect(cells[1]?.note).toBe('1 placed on the map');
  });

  it('is blank rather than zero while loading', () => {
    const cells = huntStrip({ serverId: 580, trucks: null, placed: 0, missions: null });

    expect(cells[1]?.value).toBeNull();
    expect(cells[2]?.value).toBeNull();
  });
});
