import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuideSections, type GuideSectionsProps } from './GuideSections';
import { scoreItemMapFrom } from './scoreItems';
import {
  HALLOWEEN_NOTES,
  HALLOWEEN_POINT_TABLES,
  HALLOWEEN_PREP,
  HALLOWEEN_REWARDS,
  HALLOWEEN_SOURCES,
  HALLOWEEN_STAGES,
} from './sections/fixtures';
import { type GuideSection, parseSections } from './sections/index';
import { catalogueFrom } from './sections/itemRef';

afterEach(cleanup);

const NOW = new Date('2026-11-09T12:00:00Z');

const catalogue = catalogueFrom({
  items: [
    { item_id: '253042', name: 'Orange Hero Shard' },
    { item_id: '200036', name: 'Gold Coin' },
    { item_id: '300100', name: 'Candy' },
    { item_id: '300101', name: 'Pumpkin Ammo' },
  ],
  resources: [{ resource_id: 25, name: 'Wood' }],
});

function rows(...list: { kind: string; payload: unknown; title?: string }[]): GuideSection[] {
  return list.map((row, index) => ({
    section_id: `s${index}`,
    guide_id: 'g',
    kind: row.kind,
    title: row.title ?? null,
    sort_order: index,
    source: 'officer' as const,
    payload: row.payload,
  }));
}

function view(sections: GuideSection[], over: Partial<GuideSectionsProps> = {}) {
  return render(
    <GuideSections
      catalogue={catalogue}
      iconSrc={new Map()}
      now={NOW}
      scoreItems={new Map()}
      sections={parseSections(sections)}
      stock={null}
      stockReadAt={null}
      {...over}
    />,
  );
}

describe('rewards', () => {
  it('draws one chip per reward with how it is earned beside it', () => {
    const { container } = view(rows({ kind: 'rewards', payload: HALLOWEEN_REWARDS }));
    expect(container.querySelectorAll('[data-kind="rewards"] .chip-console').length).toBe(5);
    expect(container.textContent).toContain('Pumpkin Knight skin');
    expect(container.textContent).toContain('Reach stage 30');
  });
});

describe('stages', () => {
  it('is one step table with a row per stage and the totals in the foot', () => {
    const { container } = view(rows({ kind: 'stages', payload: HALLOWEEN_STAGES }));
    const section = container.querySelector('[data-kind="stages"]');
    expect(section?.querySelectorAll('tbody tr').length).toBe(5);
    const total = section?.querySelector('tfoot tr.step-total');
    expect(total?.textContent).toContain('Orange Hero Shard');
    expect(total?.textContent).toContain('×19');
  });
});

describe('point tables', () => {
  const tables = HALLOWEEN_POINT_TABLES.map((payload) => ({ kind: 'point_table', payload }));

  it('marks the winning day and points the other days at it', () => {
    const { container } = view(rows(...tables));
    const sections = [...container.querySelectorAll('[data-kind="point_table"]')];
    const day2 = sections.find((s) => s.querySelector('h3')?.textContent?.includes('Day 2'));
    const day5 = sections.find((s) => s.querySelector('h3')?.textContent?.includes('Day 5'));
    expect(day2?.querySelector('.eg-best')?.textContent).toBe('BEST DAY');
    expect(day5?.querySelector('.eg-best')).toBeNull();
    expect(day5?.textContent).toContain('day 2');
  });

  it('says nothing about a best day for an item seen on one day only', () => {
    const { container } = view(rows(...tables));
    const day1 = [...container.querySelectorAll('[data-kind="point_table"]')].find((s) =>
      s.querySelector('h3')?.textContent?.includes('Day 1'),
    );
    const coinRow = [...(day1?.querySelectorAll('tbody tr') ?? [])].find((tr) =>
      tr.textContent?.includes('Gold Coin'),
    );
    expect(coinRow?.querySelector('.eg-best')).toBeNull();
    expect(coinRow?.textContent).not.toContain('day ');
  });

  it('shows points with their unit', () => {
    const { container } = view(rows(...tables));
    expect(container.textContent).toContain('+750');
    expect(container.textContent).toContain('per 1,000');
  });

  it('gives a client row its item once the score map names one', () => {
    const client = rows({
      kind: 'point_table',
      title: 'Training Day',
      payload: {
        day: null,
        theme: 'Training Day',
        rows: [{ score_id: '1000020101', action: 'Consume a shard', points: 300, per: 1 }],
      },
    });
    const bare = view(client);
    expect(bare.container.textContent).not.toContain('Orange Hero Shard');
    cleanup();
    const mapped = view(client, {
      scoreItems: scoreItemMapFrom([
        { score_id: '1000020101', item_ref: { kind: 'item', id: '253042' }, per: 1 },
      ]),
    });
    expect(mapped.container.textContent).toContain('Orange Hero Shard');
    expect(mapped.container.querySelector('h3')?.textContent).toBe('Training Day');
  });
});

describe('prep', () => {
  const prep = rows({ kind: 'prep', payload: HALLOWEEN_PREP });

  it('with stock: held, cap and what it is worth on its day', () => {
    const { container } = view(prep, {
      stock: { items: { '253042': 412 }, resources: {} },
      stockReadAt: '2026-11-09T09:00:00Z',
    });
    const shard = [...container.querySelectorAll('.cell')].find((cell) =>
      cell.textContent?.includes('Orange Hero Shard'),
    );
    expect(shard?.querySelector('.cell-value')?.textContent).toContain('412');
    expect(shard?.querySelector('.cell-unit')?.textContent).toBe('/412');
    expect(shard?.querySelector('.cell-context')?.textContent).toBe('→ 309,000 pts on day 2');
    expect(container.querySelector('.led')?.textContent).toBe('STOCK READ 3h');
  });

  it('without a linked account: the rule only, never 0 held', () => {
    const { container } = view(prep);
    const shard = [...container.querySelectorAll('.cell')].find((cell) =>
      cell.textContent?.includes('Orange Hero Shard'),
    );
    expect(shard?.querySelector('.cell-value')?.textContent).toBe('—');
    expect(shard?.querySelector('.cell-context')?.textContent).toBe(
      '750 pts each · cap 412 · day 2',
    );
    expect(container.querySelector('.led')?.textContent).toBe('NO LINKED ACCOUNT');
    expect(container.querySelector('.led')?.getAttribute('data-tone')).toBe('neutral');
  });

  it('an item the stock does not list stays unknown beside one it does', () => {
    const { container } = view(prep, {
      stock: { items: { '300101': 50 }, resources: {} },
      stockReadAt: '2026-11-09T09:00:00Z',
    });
    const cells = [...container.querySelectorAll('.cell')];
    const ammo = cells.find((cell) => cell.textContent?.includes('Pumpkin Ammo'));
    const shard = cells.find((cell) => cell.textContent?.includes('Orange Hero Shard'));
    expect(ammo?.querySelector('.cell-context')?.textContent).toBe('→ 50 shots');
    expect(shard?.querySelector('.cell-value')?.textContent).toBe('—');
  });
});

describe('sources and notes', () => {
  it('totals the sources in the foot', () => {
    const { container } = view(rows({ kind: 'sources', payload: HALLOWEEN_SOURCES }));
    const section = container.querySelector('[data-kind="sources"]');
    expect(section?.querySelectorAll('tbody tr').length).toBe(4);
    expect(section?.querySelector('tfoot')?.textContent).toContain('170');
    expect(section?.querySelector('tbody')?.textContent).toContain('—');
  });

  it('writes notes as paragraphs and never shows the Korean field', () => {
    const { container } = view(
      rows({ kind: 'notes', payload: { text: 'One.\n\nTwo.', text_ko: '한국어' } }),
    );
    expect(container.querySelectorAll('[data-kind="notes"] p').length).toBe(2);
    expect(container.textContent).not.toContain('한국어');
  });
});

describe('a guide with nothing to show', () => {
  it('says so instead of rendering an empty page', () => {
    const { container } = view(rows({ kind: 'stages', payload: { groups: 5 } }));
    expect(container.textContent).toContain('This guide has no sections yet.');
  });
  it('uses the section title when it has one', () => {
    const { container } = view(rows({ kind: 'notes', payload: HALLOWEEN_NOTES, title: 'Read me' }));
    expect(container.querySelector('h3')?.textContent).toBe('Read me');
  });
});

describe('guides.css keeps to the console contract', () => {
  const css = readFileSync(
    join(process.cwd(), 'src', 'features', 'eventGuide', 'guides.css'),
    'utf8',
  );
  it('has no colour literal', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
  });
  it('has no pill and no shadow', () => {
    for (const radius of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      // 3px, the console's chip and button radius; nothing rounder.
      expect(['0', 'var(--radius-md)']).toContain(radius[1]?.trim());
    }
    expect(css).not.toMatch(/box-shadow/);
  });
});
