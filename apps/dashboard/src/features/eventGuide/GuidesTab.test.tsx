import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuideHeader, GuidePicker } from './GuidesTab';
import type { GuideEntry, GuideRow, GuideStart } from './guides';

afterEach(cleanup);

const NOW = new Date('2026-11-09T12:00:00Z');

function guide(over: Partial<GuideRow>): GuideRow {
  return {
    guide_id: over.slug ?? 'g',
    activity_id: null,
    slug: 'g',
    title: 'Guide',
    title_ko: '가이드',
    summary: null,
    summary_ko: null,
    starts_rule: {},
    published: true,
    post_id: null,
    updated_at: '2026-11-01T00:00:00Z',
    ...over,
  };
}

const start = (over: Partial<GuideStart>): GuideStart => ({
  startsAt: null,
  endsAt: null,
  state: 'unknown',
  source: 'none',
  ...over,
});

const entries: GuideEntry[] = [
  {
    guide: guide({ slug: 'duel', title: 'Alliance Duel' }),
    start: start({ state: 'live', startsAt: '2026-11-09T02:00:00Z', source: 'calendar' }),
  },
  {
    guide: guide({ slug: 'halloween', title: 'Halloween', published: false }),
    start: start({ state: 'upcoming', startsAt: '2026-11-11T12:00:00Z', source: 'rule' }),
  },
  { guide: guide({ slug: 'old', title: 'Old' }), start: start({ state: 'ended' }) },
];

describe('GuidePicker', () => {
  it('lists the guides in the order given and presses the selected one', () => {
    const { container } = render(
      <GuidePicker entries={entries} now={NOW} onSelect={() => {}} selected="halloween" />,
    );
    const buttons = [...container.querySelectorAll('button.filter-chip')];
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons[0]?.textContent).toContain('Alliance Duel');
    expect(buttons[0]?.textContent).toContain('live');
    expect(buttons[1]?.textContent).toContain('in 2 d');
    expect(buttons[2]?.textContent).toContain('ended');
  });

  it('marks a draft, and tells the page which guide was chosen', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <GuidePicker entries={entries} now={NOW} onSelect={onSelect} selected="duel" />,
    );
    const buttons = [...container.querySelectorAll('button.filter-chip')];
    expect(buttons[1]?.querySelector('.eg-draft')?.textContent).toBe('DRAFT');
    expect(buttons[0]?.querySelector('.eg-draft')).toBeNull();
    fireEvent.click(buttons[2] as Element);
    expect(onSelect).toHaveBeenCalledWith('old');
  });

  it('never shows the Korean title: it is data, not interface', () => {
    const { container } = render(
      <GuidePicker entries={entries} now={NOW} onSelect={() => {}} selected="duel" />,
    );
    expect(container.textContent).not.toContain('가이드');
  });
});

describe('GuideHeader', () => {
  const led = (s: GuideStart) => {
    const { container } = render(
      <GuideHeader
        guide={guide({ title: 'Halloween', summary: 'Six days of candy.' })}
        now={NOW}
        start={s}
        zone="Etc/GMT+2"
      />,
    );
    const light = container.querySelector('.led');
    return [light?.getAttribute('data-tone'), light?.textContent];
  };

  it('says the state as an LED', () => {
    expect(led(start({ state: 'live', startsAt: '2026-11-09T02:00:00Z' }))).toEqual(['ok', 'LIVE']);
    cleanup();
    expect(led(start({ state: 'upcoming', startsAt: '2026-11-11T12:00:00Z' }))).toEqual([
      'warn',
      'STARTS IN 2 d',
    ]);
    cleanup();
    expect(led(start({ state: 'ended', startsAt: '2026-11-01T02:00:00Z' }))).toEqual([
      'neutral',
      'ENDED',
    ]);
    cleanup();
    expect(led(start({}))).toEqual(['neutral', 'NO START KNOWN']);
  });

  it('shows the title, the summary and the start in server time', () => {
    const { container } = render(
      <GuideHeader
        guide={guide({
          title: 'Halloween',
          summary: 'Six days of candy.',
          starts_rule: { weekday: 3, time: '14:00', servers: '577-584' },
        })}
        now={NOW}
        start={start({ state: 'upcoming', startsAt: '2026-11-11T16:00:00Z', source: 'rule' })}
        zone="Etc/GMT+2"
      />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Halloween');
    expect(container.textContent).toContain('Six days of candy.');
    expect(container.textContent).toContain('14:00');
    expect(container.textContent).toContain('Servers 577-584');
  });

  it('marks a draft and links the long-form post when there is one', () => {
    const { container } = render(
      <GuideHeader
        guide={guide({ title: 'Halloween', published: false, post_id: 'p1' })}
        now={NOW}
        postTitle="How to play Halloween"
        start={start({})}
        zone="Etc/GMT+2"
      />,
    );
    expect(container.querySelector('.eg-draft')?.textContent).toBe('DRAFT');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#/guides');
    expect(link?.textContent).toContain('How to play Halloween');
  });
});
