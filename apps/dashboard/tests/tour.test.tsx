import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Tour } from '../src/components/shell/Tour';
import { TOUR_STEPS, nextStep } from '../src/lib/tour';

describe('nextStep', () => {
  it('walks to the end and then stops', () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(TOUR_STEPS.length - 1)).toBeNull();
  });
});

describe('Tour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on a first visit and remembers being finished', () => {
    const { unmount } = render(<Tour />);
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Welcome tour')).toBeNull();
    unmount();
    render(<Tour />);
    expect(screen.queryByLabelText('Welcome tour')).toBeNull();
  });

  it('skip also counts as seen', () => {
    render(<Tour />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(window.localStorage.getItem('dw-tour')).toBe('done');
  });
});
