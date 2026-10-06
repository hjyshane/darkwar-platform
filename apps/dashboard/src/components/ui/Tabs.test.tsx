import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';
import { placeTip } from './tooltipLogic';

const ITEMS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta', disabled: true },
  { id: 'c', label: 'Gamma' },
] as const;

afterEach(cleanup);

describe('Tabs', () => {
  it('keeps only the selected tab in the tab order', () => {
    render(<Tabs items={ITEMS} label="Letters" onChange={() => {}} value="c" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  });
  it('leaves the first enabled tab reachable when the value matches nothing', () => {
    render(<Tabs items={ITEMS} label="Letters" onChange={() => {}} value="gone" />);
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });
  it('arrows move focus only, and do not select, by default', () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} label="Letters" onChange={onChange} value="a" />);
    const [a, , c] = screen.getAllByRole('tab') as HTMLElement[];
    fireEvent.keyDown(a as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(c);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('leaves modified arrows (browser Back/Forward) alone', () => {
    const onChange = vi.fn();
    render(<Tabs activation="auto" items={ITEMS} label="Letters" onChange={onChange} value="a" />);
    fireEvent.keyDown(screen.getAllByRole('tab')[0] as HTMLElement, {
      key: 'ArrowRight',
      altKey: true,
    });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('with auto activation, moves with the arrows, skipping disabled tabs and wrapping', () => {
    const onChange = vi.fn();
    render(<Tabs activation="auto" items={ITEMS} label="Letters" onChange={onChange} value="a" />);
    const [a, , c] = screen.getAllByRole('tab') as HTMLElement[];
    fireEvent.keyDown(a as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(c as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(a as HTMLElement, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(c as HTMLElement, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
  it('selects on click', () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} label="Letters" onChange={onChange} value="a" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
});

describe('placeTip', () => {
  const viewport = { width: 400, height: 300 };
  const tip = { width: 100, height: 30 };
  it('centres under the anchor', () => {
    const p = placeTip({ left: 150, top: 50, width: 40, height: 20 }, tip, viewport);
    expect(p).toEqual({ left: 120, top: 78, above: false });
  });
  it('flips above when there is no room below', () => {
    const p = placeTip({ left: 150, top: 270, width: 40, height: 20 }, tip, viewport);
    expect(p.above).toBe(true);
    expect(p.top).toBe(270 - 8 - 30);
  });
  it('stays inside the viewport at either edge', () => {
    expect(placeTip({ left: 0, top: 50, width: 10, height: 10 }, tip, viewport).left).toBe(8);
    expect(placeTip({ left: 395, top: 50, width: 10, height: 10 }, tip, viewport).left).toBe(292);
  });
});
