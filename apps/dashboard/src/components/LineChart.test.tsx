import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Series } from '../lib/series';
import { LineChart } from './LineChart';

/** The legend-click isolation added alongside the ten-hue palette: clicking a
 * legend entry shows only that line and RESCALES the axis to it, clicking it
 * again brings everybody back. Tested at the component level because the
 * look-around build is the only place a chart renders outside production, and
 * its fixtures drift. */

function series(count: number): Series[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `line-${index}`,
    slot: index,
    points: [
      // line-0 lives in single digits; everybody else in the thousands, so
      // isolating line-0 must visibly change the axis labels.
      { t: 1_000, v: index === 0 ? 1 : 1_000 + index * 100 },
      { t: 2_000, v: index === 0 ? 9 : 2_000 + index * 100 },
    ],
  }));
}

function draw(count: number) {
  return render(
    <LineChart
      formatTime={(t) => String(t)}
      formatValue={(v) => String(v)}
      label="test chart"
      series={series(count)}
    />,
  );
}

afterEach(cleanup);

/** Indexing under noUncheckedIndexedAccess: a missing element is a broken
 * test, so it throws rather than teaching every call site about undefined. */
function at(list: HTMLElement[], index: number): HTMLElement {
  const element = list[index];
  if (element === undefined) {
    throw new Error(`no element at ${index} of ${list.length}`);
  }
  return element;
}

describe('LineChart legend isolation', () => {
  it('draws every line with a distinct slot class, past the old six-hue wrap', () => {
    const { container } = draw(8);
    const classes = [...container.querySelectorAll('path.chart-line')].map((p) =>
      [...p.classList].find((c) => c.startsWith('chart-slot-')),
    );
    expect(classes).toHaveLength(8);
    // Slot 6 and 7 used to wrap back to 0 and 1; now every line keeps its own.
    expect(new Set(classes).size).toBe(8);
  });

  it('clicking a legend entry isolates its line and rescales the axis', () => {
    const { container, getAllByRole } = draw(3);
    expect(container.querySelectorAll('path.chart-line')).toHaveLength(3);
    const axisBefore = [...container.querySelectorAll('text.chart-axis')].map((t) => t.textContent);

    const legend = getAllByRole('button').filter((b) => b.className.includes('chart-legend'));
    expect(legend).toHaveLength(3);
    fireEvent.click(at(legend, 0));

    expect(container.querySelectorAll('path.chart-line')).toHaveLength(1);
    expect(at(legend, 0).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.chart-legend-dimmed')).toHaveLength(2);
    // line-0 spans 1..9 while the shared extent spanned into the thousands, so
    // the gridline labels must have changed with the isolation.
    const axisAfter = [...container.querySelectorAll('text.chart-axis')].map((t) => t.textContent);
    expect(axisAfter).not.toEqual(axisBefore);
  });

  it('clicking the isolated entry again restores every line', () => {
    const { container, getAllByRole } = draw(3);
    const legend = getAllByRole('button').filter((b) => b.className.includes('chart-legend'));
    fireEvent.click(at(legend, 0));
    fireEvent.click(at(legend, 0));
    expect(container.querySelectorAll('path.chart-line')).toHaveLength(3);
    expect(container.querySelectorAll('.chart-legend-dimmed')).toHaveLength(0);
  });

  it('clicking a dimmed entry switches the isolation to it directly', () => {
    const { container, getAllByRole } = draw(3);
    const legend = getAllByRole('button').filter((b) => b.className.includes('chart-legend'));
    fireEvent.click(at(legend, 0));
    fireEvent.click(at(legend, 2));
    expect(container.querySelectorAll('path.chart-line')).toHaveLength(1);
    expect(at(legend, 2).getAttribute('aria-pressed')).toBe('true');
    expect(at(legend, 0).getAttribute('aria-pressed')).toBe('false');
  });
});
