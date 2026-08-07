// The delegated listener: which presses it takes and which it leaves alone.
//
// jsdom does not lay anything out, so the sizes are defined onto the element.
// That is fine here — the arithmetic lives in `sidewaysStep` and has its own
// tests; what this file covers is the wiring: finding the right scroller from
// wherever the cursor was, and refusing to preventDefault on a press it did not
// use.
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useSidewaysMouse } from '../src/lib/useSidewaysMouse';

function Harness() {
  useSidewaysMouse();
  return (
    <div className="table-wrap" data-testid="wrap">
      <table>
        <tbody>
          <tr>
            <td>
              <span data-testid="deep">a cell, several elements down</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function setUp(scrollLeft: number, scrollWidth: number) {
  const view = render(<Harness />);
  const wrap = view.getByTestId('wrap');
  Object.defineProperty(wrap, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(wrap, 'clientWidth', { value: 1000, configurable: true });
  wrap.scrollLeft = scrollLeft;
  return { view, wrap, deep: view.getByTestId('deep') };
}

function press(target: Element, button: number): MouseEvent {
  const event = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

test('a press over a cell scrolls the table it is in', () => {
  const { wrap, deep } = setUp(500, 2000);
  const event = press(deep, 4);
  expect(wrap.scrollLeft).toBe(700);
  // Refused, so Chrome does not also navigate forward.
  expect(event.defaultPrevented).toBe(true);
});

test('back scrolls the other way', () => {
  const { wrap, deep } = setUp(500, 2000);
  press(deep, 3);
  expect(wrap.scrollLeft).toBe(300);
});

// The assertion this file exists for.
test('a press with nothing to scroll is left as a Back', () => {
  const { wrap, deep } = setUp(0, 2000);
  const event = press(deep, 3);
  expect(wrap.scrollLeft).toBe(0);
  expect(event.defaultPrevented).toBe(false);
});

test('a table that fits leaves both buttons alone', () => {
  const { deep } = setUp(0, 1000);
  expect(press(deep, 3).defaultPrevented).toBe(false);
  expect(press(deep, 4).defaultPrevented).toBe(false);
});

test('a press outside any table is none of our business', () => {
  setUp(500, 2000);
  const outside = document.createElement('div');
  document.body.append(outside);
  expect(press(outside, 4).defaultPrevented).toBe(false);
});

test('the ordinary buttons are untouched', () => {
  const { wrap, deep } = setUp(500, 2000);
  for (const button of [0, 1, 2]) {
    expect(press(deep, button).defaultPrevented).toBe(false);
  }
  expect(wrap.scrollLeft).toBe(500);
});

test('unmounting stops listening', () => {
  const { view, wrap, deep } = setUp(500, 2000);
  view.unmount();
  press(deep, 4);
  expect(wrap.scrollLeft).toBe(500);
});
