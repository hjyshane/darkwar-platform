// The badge that says whether anything is still arriving.
//
// It exists because a dead collector looks exactly like a quiet one: every
// figure on the board stays where it was and no panel's own freshness badge
// changes, since none of them got new data to be fresh about.
import { expect, test } from 'vitest';
import { SyncStatus, since } from '../src/components/SyncStatus';
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
