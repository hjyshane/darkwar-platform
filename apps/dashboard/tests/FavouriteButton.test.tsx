// A toggle button, so the state lives in aria-pressed rather than in a
// label that flips wording — and the accessible name says WHICH row, since
// forty buttons all called "Favourite" locate nothing.
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { FavouriteButton } from '../src/components/FavouriteButton';
import { FavouritesFilter } from '../src/components/FavouritesFilter';

test('the pressed state says whether it is starred', () => {
  const { rerender } = render(
    <FavouriteButton
      id="p1"
      isFavourite={false}
      kind="player"
      label="ShaneKim"
      onToggle={() => {}}
    />,
  );
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');

  rerender(
    <FavouriteButton id="p1" isFavourite kind="player" label="ShaneKim" onToggle={() => {}} />,
  );
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
});

test('the accessible name identifies the row', () => {
  render(
    <FavouriteButton
      id="p1"
      isFavourite={false}
      kind="player"
      label="전투광"
      onToggle={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: 'Favourite 전투광' })).toBeDefined();
});

test('toggling reports both the kind and the id', () => {
  // The hook needs both: the same uuid could in principle be a player or an
  // alliance, and they live in different columns.
  const onToggle = vi.fn();
  render(
    <FavouriteButton
      id="a1"
      isFavourite={false}
      kind="alliance"
      label="CBFW"
      onToggle={onToggle}
    />,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(onToggle).toHaveBeenCalledWith('alliance', 'a1');
});

test('the filter hides itself when there is nothing starred', () => {
  // Pressing a filter that can only produce an empty table reads as the
  // data having broken.
  const { container } = render(<FavouritesFilter active={false} count={0} onChange={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test('the filter stays visible while active, even at zero', () => {
  // Otherwise unstarring the last row would remove the control that is
  // filtering the table, stranding the user on an empty one.
  render(<FavouritesFilter active count={0} onChange={() => {}} />);
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
});
