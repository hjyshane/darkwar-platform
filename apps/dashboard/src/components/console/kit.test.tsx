import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip } from './Chip';
import { Led } from './Led';
import { type Tick, Ticks } from './Ticks';
import { Verdict } from './Verdict';

afterEach(cleanup);

describe('Led', () => {
  it('carries its tone and hides the dot from assistive tech', () => {
    const { container } = render(<Led tone="bad">SHIELD OFF 7d</Led>);
    expect(container.querySelector('.led')?.getAttribute('data-tone')).toBe('bad');
    expect(container.querySelector('.led-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.led')?.textContent).toBe('SHIELD OFF 7d');
  });

  it('passes a title through for the long form', () => {
    const { container } = render(
      <Led title="Shield expired 1 November" tone="bad">
        SHIELD OFF
      </Led>,
    );
    expect(container.querySelector('.led')?.getAttribute('title')).toBe(
      'Shield expired 1 November',
    );
  });
});

describe('Verdict', () => {
  it('renders one paragraph with inline code figures', () => {
    const { container } = render(
      <Verdict>
        #1 on 576 by <code>5.31M</code>.
      </Verdict>,
    );
    expect(container.querySelectorAll('p.verdict').length).toBe(1);
    expect(container.querySelector('p.verdict code')?.textContent).toBe('5.31M');
  });
});

describe('Chip', () => {
  it('does not use the arena .chip class and shows figure and suffix', () => {
    const { container } = render(<Chip figure={750} label="Orange hero shard" suffix="d5–6 500" />);
    expect(container.querySelector('.chip')).toBeNull();
    expect(container.querySelector('.chip-console .chip-label')?.textContent).toBe(
      'Orange hero shard',
    );
    expect(container.querySelector('.chip-console .chip-figure')?.textContent).toBe('750');
    expect(container.querySelector('.chip-console .chip-suffix')?.textContent).toBe('d5–6 500');
  });

  it('omits the icon, figure and suffix slots when not given', () => {
    const { container } = render(<Chip label="Titanium" />);
    expect(container.querySelector('.chip-icon')).toBeNull();
    expect(container.querySelector('.chip-figure')).toBeNull();
    expect(container.querySelector('.chip-suffix')).toBeNull();
  });
});

describe('Ticks', () => {
  const items: readonly Tick[] = [
    { key: 'hero', label: 'heroes', value: '104M', share: 0.31, rank: 2 },
    { key: 'tech', label: 'tech', value: '67.0M', share: 0.2, rank: 1, delta: '+1.21M' },
    { key: 'troops', label: 'troops', value: '375M' },
  ];

  it('marks rank 1 as top and sets the bar width from share', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    const ticks = container.querySelectorAll('li.tick');
    expect(ticks.length).toBe(3);
    expect(ticks[1]?.hasAttribute('data-top')).toBe(true);
    expect(ticks[0]?.hasAttribute('data-top')).toBe(false);
    expect((ticks[0] as HTMLElement).style.getPropertyValue('--w')).toBe('31%');
  });

  it('renders no percent and no width for an item without share', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    const troops = container.querySelectorAll('li.tick')[2] as HTMLElement;
    expect(troops.style.getPropertyValue('--w')).toBe('');
    expect(troops.textContent).not.toMatch(/%|NaN/);
  });

  it('shows the rank badge and delta only when given', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    const ticks = container.querySelectorAll('li.tick');
    expect(ticks[0]?.querySelector('.tick-rank')?.textContent).toBe('#2');
    expect(ticks[1]?.querySelector('.tick-delta')?.textContent).toBe('+1.21M');
    expect(ticks[2]?.querySelector('.tick-rank')).toBeNull();
    expect(ticks[0]?.querySelector('.tick-delta')).toBeNull();
  });

  it('writes the share as a rounded percent beside the label', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    expect(
      container.querySelectorAll('li.tick')[0]?.querySelector('.tick-label')?.textContent,
    ).toBe('heroes · 31%');
  });

  it('labels the list for assistive tech', () => {
    const { container } = render(<Ticks ariaLabel="Composition" items={items} />);
    expect(container.querySelector('ul.ticks')?.getAttribute('aria-label')).toBe('Composition');
  });
});
