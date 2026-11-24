import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapLoadError } from './MapLoadError';

afterEach(cleanup);

const TIMEOUT = new Error('map query failed: canceling statement due to statement timeout');

describe('MapLoadError', () => {
  it('tells the reader to refresh on a timeout and keeps the database wording off the screen', () => {
    render(<MapLoadError error={TIMEOUT} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Refresh the page to try again');
    expect(alert.textContent).not.toContain('statement timeout');
  });

  it('offers a Try again button that runs the retry', () => {
    const onRetry = vi.fn();
    render(<MapLoadError error={TIMEOUT} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no button when nothing can be retried', () => {
    render(<MapLoadError error={TIMEOUT} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the detail of a failure that is not the timeout', () => {
    render(<MapLoadError error={new Error('map query failed: permission denied')} />);
    expect(screen.getByRole('alert').textContent).toContain('permission denied');
  });
});
