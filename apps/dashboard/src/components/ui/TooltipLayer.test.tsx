import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipLayer } from './TooltipLayer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function hover(el: Element) {
  fireEvent.pointerOver(el, { pointerType: 'mouse' });
}

describe('TooltipLayer', () => {
  it('shows the title as a tooltip after a pause and parks the native one', () => {
    render(
      <>
        <button title="Power now" type="button">
          Power
        </button>
        <TooltipLayer />
      </>,
    );
    const button = screen.getByRole('button');
    hover(button);
    expect(button.getAttribute('title')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Power now');
  });
  it('puts the title back when the pointer leaves', () => {
    render(
      <>
        <button title="Power now" type="button">
          Power
        </button>
        <TooltipLayer />
      </>,
    );
    const button = screen.getByRole('button');
    hover(button);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.pointerOut(button, { pointerType: 'mouse', relatedTarget: document.body });
    expect(button.getAttribute('title')).toBe('Power now');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('lends an icon-only control its title as a name while the title is parked', () => {
    render(
      <>
        <button title="Refresh" type="button" />
        <TooltipLayer />
      </>,
    );
    const button = screen.getByRole('button');
    hover(button);
    expect(button.getAttribute('aria-label')).toBe('Refresh');
    fireEvent.pointerOut(button, { pointerType: 'mouse', relatedTarget: document.body });
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.getAttribute('title')).toBe('Refresh');
  });
  it('ignores touch', () => {
    render(
      <>
        <button title="Power now" type="button">
          Power
        </button>
        <TooltipLayer />
      </>,
    );
    const button = screen.getByRole('button');
    // jsdom has no PointerEvent and drops `pointerType` from the init, so the
    // event is built by hand.
    const touch = new Event('pointerover', { bubbles: true });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    act(() => {
      button.dispatchEvent(touch);
    });
    expect(button.getAttribute('title')).toBe('Power now');
  });
});
