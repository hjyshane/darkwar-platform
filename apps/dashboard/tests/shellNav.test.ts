import { describe, expect, it } from 'vitest';
import type { Route } from '../src/lib/route';
import type { Season } from '../src/lib/seasons';
import {
  type NavContext,
  breadcrumb,
  buildFooter,
  buildNav,
  humanUntil,
  nextUp,
  seasonLine,
} from '../src/lib/shellNav';

const base = (over: Partial<NavContext> = {}): NavContext => ({
  route: 'overview',
  allianceId: null,
  own: { alliance_id: 'a1', label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: false,
  seasonNames: {},
  ...over,
});

const labels = (ctx: NavContext, group: string) =>
  buildNav(ctx)
    .find((entry) => entry.id === group)
    ?.items.map((item) => item.label) ?? [];

describe('buildNav', () => {
  it('lists the groups in the order the sidebar draws them', () => {
    expect(buildNav(base()).map((group) => group.id)).toEqual([
      'watch',
      'alliance',
      'events',
      'boards',
    ]);
  });

  it('keeps every address the old tabs had', () => {
    const hrefs = buildNav(base({ isAdmin: true, isOfficer: true })).flatMap((group) =>
      group.items.map((item) => item.href),
    );
    for (const hash of [
      '#/',
      '#/rankings',
      '#/migration',
      '#/map',
      '#/hive',
      '#/season',
      '#/season2',
    ]) {
      expect(hrefs).toContain(hash);
    }
    expect(hrefs).toContain('#/event-guide');
    expect(hrefs).toContain('#/notices');
  });

  it('shows Migration to officers only and Season 2 to admins only', () => {
    expect(labels(base(), 'watch')).not.toContain('Migration');
    expect(labels(base({ isOfficer: true }), 'watch')).toContain('Migration');
    expect(labels(base(), 'alliance')).not.toContain('Season 2');
    expect(labels(base({ isAdmin: true }), 'alliance')).toContain('Season 2');
  });

  it('waits for the permission grid before showing Members', () => {
    expect(labels(base({ mayViewMembers: undefined }), 'alliance')).not.toContain('Members');
    expect(labels(base({ mayViewMembers: false }), 'alliance')).not.toContain('Members');
    expect(labels(base({ mayViewMembers: true }), 'alliance')).toContain('Members');
  });

  it('puts our own alliance first, and leaves it out until it is known', () => {
    expect(labels(base(), 'alliance')[0]).toBe('CBFW');
    expect(labels(base({ own: null }), 'alliance')[0]).not.toBe('CBFW');
  });

  it('names the season entries from the seasons table', () => {
    const names = { '#/season': 'Season 4', '#/season2': 'Season 3' };
    expect(labels(base({ isAdmin: true, seasonNames: names }), 'alliance')).toEqual(
      expect.arrayContaining(['Season 4', 'Season 3']),
    );
  });

  it('marks one entry current: the screen you are on', () => {
    const current = (route: Route) =>
      buildNav(base({ route }))
        .flatMap((group) => group.items)
        .filter((item) => item.current)
        .map((item) => item.label);

    expect(current('hive')).toEqual(['Hive']);
    expect(current('eventGuide')).toEqual(['Event guide']);
    // All three ranking boards stand under one entry.
    expect(current('arena')).toEqual(['Rankings']);
    expect(current('crossRankings')).toEqual(['Rankings']);
    // A single notice is still the notices board.
    expect(current('notice')).toEqual(['Notices']);
    // A player belongs to no group.
    expect(current('player')).toEqual([]);
  });

  it('marks our alliance current only on its own page', () => {
    const on = (allianceId: string) =>
      buildNav(base({ route: 'alliance', allianceId }))
        .flatMap((group) => group.items)
        .filter((item) => item.current)
        .map((item) => item.label);

    expect(on('a1')).toEqual(['CBFW']);
    expect(on('somebody-else')).toEqual([]);
  });
});

describe('buildFooter and breadcrumb', () => {
  it('offers Settings to admins only', () => {
    expect(buildFooter('overview', false).map((item) => item.label)).toEqual(['My account']);
    expect(buildFooter('overview', true).map((item) => item.label)).toEqual([
      'Settings',
      'My account',
    ]);
  });

  it('says the group and the screen, or just the screen when it has no group', () => {
    const at = (route: Route) => {
      const ctx = base({ route });
      return breadcrumb(buildNav(ctx), buildFooter(route, true), route);
    };

    expect(at('hive')).toEqual(['Alliance', 'Hive']);
    expect(at('account')).toEqual(['My account']);
    expect(at('player')).toEqual(['Player']);
  });
});

describe('humanUntil', () => {
  it('is coarse on purpose', () => {
    expect(humanUntil(20_000)).toBe('under a minute');
    expect(humanUntil(28 * 60_000)).toBe('28 min');
    expect(humanUntil(2 * 3_600_000)).toBe('2 h');
    expect(humanUntil(2 * 3_600_000 + 10 * 60_000)).toBe('2 h 10 min');
    expect(humanUntil(3 * 86_400_000 + 5 * 3_600_000)).toBe('3 d');
  });
});

describe('seasonLine', () => {
  const season = (id: number, startsAt: string | null, endsAt: string | null): Season => ({
    id,
    name: `Season ${id}`,
    startsAt,
    endsAt,
    buildings: [],
  });
  const now = new Date('2026-10-08T20:00:00Z');

  it('counts down to the end of the season that is running', () => {
    expect(seasonLine([season(3, '2026-08-17T02:00:00Z', '2026-10-10T20:00:00Z')], now)).toBe(
      'Season 3 ends in 2 d',
    );
  });

  it('says so in the rest between two seasons, and when the next begins', () => {
    const rest = [
      season(3, '2026-08-17T02:00:00Z', '2026-10-05T02:00:00Z'),
      season(4, '2026-11-09T02:00:00Z', null),
    ];
    expect(seasonLine(rest, now)).toBe('Season 3 is over. Season 4 starts in 31 d');
  });

  it('is just the name while a season has no end, and null with nothing started', () => {
    expect(seasonLine([season(3, '2026-08-17T02:00:00Z', null)], now)).toBe('Season 3');
    expect(seasonLine([season(4, '2026-11-09T02:00:00Z', null)], now)).toBeNull();
  });
});

describe('nextUp', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('is the soonest entry that has not started', () => {
    const next = nextUp(
      [
        { title: 'Past', startsAt: '2026-10-08T02:30:00Z' },
        { title: 'Later', startsAt: '2026-10-11T12:05:00Z' },
        { title: 'Frankie 2', startsAt: '2026-10-08T15:00:00Z' },
      ],
      now,
    );

    expect(next).toEqual({ title: 'Frankie 2', inMs: 3 * 3_600_000 });
  });

  it('is null when nothing is ahead', () => {
    expect(nextUp([{ title: 'Past', startsAt: '2026-10-08T02:30:00Z' }], now)).toBeNull();
    expect(nextUp([], now)).toBeNull();
  });
});
