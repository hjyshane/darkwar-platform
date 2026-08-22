import { expect, test } from 'vitest';
import { MIN_QUERY, type Sighting, isStale, newestPerPlayer } from './mapLocations';

/** The first result, or a failure that names the reason.
 *
 * `noUncheckedIndexedAccess` is on, and rightly: an empty result here would
 * otherwise read as `undefined.at` deep inside an assertion rather than as
 * "the reducer returned nothing".
 */
function first(found: readonly Sighting[]): Sighting {
  const one = found[0];
  if (one === undefined) {
    throw new Error('expected at least one sighting');
  }
  return one;
}

function row(over: Partial<Parameters<typeof newestPerPlayer>[0][number]> = {}) {
  return {
    player_id: '11111111-1111-4111-8111-111111111111',
    game_uid: 1234567890580001,
    name: 'WonderingDuck',
    server_id: 580,
    x: 491,
    y: 444,
    hq_level: 30,
    captured_at: '2026-08-22T10:00:00Z',
    ...over,
  };
}

test('a player seen many times keeps only the newest sighting', () => {
  // A tile is written once per pan, so a member the collector passes often
  // has hundreds of rows. All of them on the map would be one player drawn
  // as a trail.
  const rows = [
    row({ captured_at: '2026-08-20T10:00:00Z', x: 100, y: 100 }),
    row({ captured_at: '2026-08-22T10:00:00Z', x: 491, y: 444 }),
    row({ captured_at: '2026-08-21T10:00:00Z', x: 200, y: 200 }),
  ];

  const found = newestPerPlayer(rows);

  expect(found).toHaveLength(1);
  expect(first(found).at).toEqual({ x: 491, y: 444 });
});

test('players outside the alliance do not collapse into one entry', () => {
  // THE BUG THIS PREVENTS. A player who is not in the alliance has no
  // player_id. Keying on it would fold every stranger on the server into a
  // single null-keyed row, and a search for a rival would return one
  // arbitrary base.
  const rows = [
    row({ player_id: null, game_uid: 1, name: 'RivalOne', x: 10, y: 10 }),
    row({ player_id: null, game_uid: 2, name: 'RivalTwo', x: 20, y: 20 }),
  ];

  expect(newestPerPlayer(rows)).toHaveLength(2);
});

test('a uid arriving as a string is still the same player', () => {
  // bigint comes back from PostgREST as a string once it exceeds 2^53, and
  // uids here are 16 digits. Two spellings of one uid must not be two rows.
  const rows = [
    row({ game_uid: '1234567890580001', captured_at: '2026-08-21T10:00:00Z' }),
    row({ game_uid: 1234567890580001, captured_at: '2026-08-22T10:00:00Z' }),
  ];

  expect(newestPerPlayer(rows)).toHaveLength(1);
});

test('results are newest first', () => {
  const rows = [
    row({ game_uid: 1, captured_at: '2026-08-20T10:00:00Z' }),
    row({ game_uid: 2, captured_at: '2026-08-22T10:00:00Z' }),
  ];

  expect(newestPerPlayer(rows).map((s) => s.gameUid)).toEqual([2, 1]);
});

test('a sighting older than a day is stale', () => {
  const now = new Date('2026-08-22T12:00:00Z');
  const fresh = first(newestPerPlayer([row({ captured_at: '2026-08-22T10:00:00Z' })]));
  const old = first(newestPerPlayer([row({ captured_at: '2026-08-19T10:00:00Z' })]));

  expect(isStale(fresh, now)).toBe(false);
  expect(isStale(old, now)).toBe(true);
});

test('the search needs more than a single character', () => {
  // One character matches most of the roster, which puts the screen back at
  // the wall of dots the search exists to avoid.
  expect(MIN_QUERY).toBeGreaterThan(1);
});

test('a sighting carries the name the game shows, never an id', () => {
  const found: Sighting = first(newestPerPlayer([row()]));

  expect(found.name).toBe('WonderingDuck');
});
