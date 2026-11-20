// What the page says about a layout. The rules are pinned in placement.test.ts;
// this is that the buttons and the verdict are wired to them.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BasePlacementPage, parseState } from './BasePlacementPage';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('BasePlacementPage', () => {
  it('starts with the Trade Shop, no bases, and a territory with room', () => {
    render(<BasePlacementPage />);
    expect(screen.getByText(/Not sealed/)).toBeTruthy();
    expect(screen.getByText('0 bases placed')).toBeTruthy();
  });

  it('is sealed after the ring is placed, and says eight bases', () => {
    render(<BasePlacementPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Place the sealing ring' }));
    expect(screen.getByText(/Sealed: no other base fits/)).toBeTruthy();
    expect(screen.getByText('8 bases placed')).toBeTruthy();
  });

  it('refuses a typed base on the building and one on another base', () => {
    render(<BasePlacementPage />);
    const [x, y] = screen.getAllByRole('textbox').slice(0, 2) as [
      HTMLInputElement,
      HTMLInputElement,
    ];
    fireEvent.change(x, { target: { value: '377' } });
    fireEvent.change(y, { target: { value: '436' } });
    expect(screen.getByText(/cannot stand on its footprint/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add base' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(x, { target: { value: '372' } });
    fireEvent.change(y, { target: { value: '431' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add base' }));
    expect(screen.getByText('1 base placed')).toBeTruthy();
    fireEvent.change(x, { target: { value: '373' } });
    fireEvent.change(y, { target: { value: '431' } });
    expect(screen.getByText(/Overlaps another base/)).toBeTruthy();
  });

  it('forgets nothing on a reload', () => {
    const first = render(<BasePlacementPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Place the sealing ring' }));
    first.unmount();
    render(<BasePlacementPage />);
    expect(screen.getByText('8 bases placed')).toBeTruthy();
  });
});

describe('parseState', () => {
  it('falls back to the default for damaged storage', () => {
    for (const raw of [
      null,
      '',
      '{',
      '{"structures":1,"bases":[]}',
      '{"structures":[{"id":1}],"bases":[]}',
    ]) {
      expect(parseState(raw).structures).toHaveLength(1);
      expect(parseState(raw).bases).toEqual([]);
    }
  });
  it('refuses an even footprint', () => {
    const raw = JSON.stringify({
      structures: [{ id: 'a', name: 'x', x: 1, y: 1, footprint: 4, area: null }],
      bases: [],
    });
    expect(parseState(raw).structures[0]?.footprint).toBe(5);
  });
});
