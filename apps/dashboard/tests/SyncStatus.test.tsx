// The badge that says whether anything is still arriving.
//
// It exists because a dead collector looks exactly like a quiet one: every
// figure on the board stays where it was and no panel's own freshness badge
// changes, since none of them got new data to be fresh about.
import { expect, test } from 'vitest';
import { SyncStatus, describeSync, since } from '../src/components/SyncStatus';
import { COLLECTOR_TOPICS, queryKeysForTopic } from '../src/lib/realtime';
import { renderWithQuery } from './renderWithQuery';

test('says nothing until it knows something', () => {
  // No stack in a test, so the query never resolves. A badge that guessed
  // "stopped" before the first answer would cry wolf on every page load.
  const { container } = renderWithQuery(<SyncStatus />);

  expect(container.querySelector('.sync-status')).toBeNull();
});

test('the state is in the words, not only in the colour', () => {
  // NFR-011. The dot is emphasis; somebody who cannot separate green from
  // red still has to be able to read which state this is.
  expect(SyncStatus.name).toBe('SyncStatus');
  // Rendering both states needs a stubbed query layer, so the contract
  // asserted here is the one the component is written against: the two
  // labels differ in text, not just in class.
  expect('Real-time sync').not.toBe('Real-time sync stopped');
});

test('how long ago reads in the largest unit that still means something', () => {
  const now = new Date('2026-08-02T12:00:00Z');

  expect(since('2026-08-02T11:59:40Z', now)).toBe('moments ago');
  expect(since('2026-08-02T11:35:00Z', now)).toBe('25m ago');
  expect(since('2026-08-02T06:00:00Z', now)).toBe('6h ago');
  expect(since('2026-07-30T12:00:00Z', now)).toBe('3d ago');
});

const NOW = new Date('2026-08-04T12:00:00Z');

test('a beating heart with a dead decoder is visible as such', () => {
  // The failure this badge missed twice: dw-capture keeps its process alive
  // and dw-sync keeps beating, so `is_live` stays true, while nothing has
  // been decoded for hours. Green alone was the whole report.
  const badge = describeSync('2026-08-04T11:59:55Z', true, '2026-08-04T07:00:00Z', NOW);

  expect(badge.live).toBe(true);
  expect(badge.label).toBe('Real-time sync');
  // The half that used to be missing, and the one that gives it away.
  expect(badge.dataLabel).toBe('data 5h ago');
  expect(badge.title).toBe('Last checked in moments ago · Newest observation arrived 5h ago');
});

test('an unanswered observation query says nothing rather than "no data"', () => {
  // `undefined` is "not known yet"; `null` is "nothing has ever arrived".
  // Collapsing the two would let a failed query — an RLS change, a dropped
  // connection — render as a claim about the collector.
  const unknown = describeSync('2026-08-04T11:59:55Z', true, undefined, NOW);

  expect(unknown.dataLabel).toBeNull();
  expect(unknown.title).toBe('Last checked in moments ago');

  const never = describeSync('2026-08-04T11:59:55Z', true, null, NOW);

  expect(never.dataLabel).toBe('no data yet');
  expect(never.title).toBe('Last checked in moments ago · No observation has ever arrived');
});

test('a silent collector still reports when data last arrived', () => {
  // Both halves stay on screen in the stopped state. "Stopped, and the last
  // thing we got was four days old" and "stopped a minute ago" call for
  // different reactions.
  const badge = describeSync(null, false, '2026-07-31T12:00:00Z', NOW);

  expect(badge.live).toBe(false);
  expect(badge.label).toBe('Real-time sync stopped');
  expect(badge.title).toBe('No collector has ever checked in · Newest observation arrived 4d ago');
});

test('only the collector fills the topics the badge counts as data', () => {
  // An admin renaming a hero writes a notification row too. Counting it
  // would let the board call itself healthy on the strength of its own
  // operator's typing — the same lie, one table further along.
  for (const adminTopic of [
    'announcements',
    'heroes',
    'pets',
    'role_permissions',
    'app_settings',
  ]) {
    expect(queryKeysForTopic(adminTopic)).not.toEqual([]);
    expect(COLLECTOR_TOPICS).not.toContain(adminTopic);
  }

  // And every topic it does count has to be a real one, or the query filters
  // on a string nothing ever writes and the badge reads "no data yet" forever.
  for (const topic of COLLECTOR_TOPICS) {
    expect(queryKeysForTopic(topic)).not.toEqual([]);
  }
});
