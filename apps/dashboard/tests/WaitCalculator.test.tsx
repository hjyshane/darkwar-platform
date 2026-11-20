import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SeasonWaitCalculator } from '../src/features/season/SeasonWaitCalculator';

/** Type the three figures the way a member would. */
function fill({ rate, current, needed }: { rate?: string; current?: string; needed?: string }) {
  if (rate !== undefined) {
    fireEvent.change(screen.getByLabelText('Output per hour'), { target: { value: rate } });
  }
  if (current !== undefined) {
    fireEvent.change(screen.getByLabelText('Current amount'), { target: { value: current } });
  }
  if (needed !== undefined) {
    fireEvent.change(screen.getByLabelText('Amount needed to upgrade'), {
      target: { value: needed },
    });
  }
}

test('three figures give a wait', () => {
  render(<SeasonWaitCalculator />);
  // Separators as the game draws them: 1,200 an hour against a 60,000 gap.
  fill({ rate: '1,200', current: '40,000', needed: '100,000' });
  expect(screen.getByText('2d 2h')).toBeDefined();
});

test('an unfilled box answers with a dash, not a zero', () => {
  render(<SeasonWaitCalculator />);
  fill({ rate: '1000', current: '500' });
  expect(screen.getByText('—')).toBeDefined();
});

// The one answer a member could act on wrongly: a stockpile that already
// covers the upgrade has to say so, not print a very short wait.
test('having enough already says ready', () => {
  render(<SeasonWaitCalculator />);
  fill({ rate: '1000', current: '100000', needed: '100000' });
  expect(screen.getByText('Ready now')).toBeDefined();
});

test('a zero rate says never rather than printing infinity', () => {
  render(<SeasonWaitCalculator />);
  fill({ rate: '0', current: '0', needed: '100' });
  expect(screen.getByText('Never at this rate')).toBeDefined();
});
