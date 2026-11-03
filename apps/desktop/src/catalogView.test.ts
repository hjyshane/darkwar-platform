// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { type CatalogEntry, matches, renderCatalog } from './catalogView';

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  command: 'world.get.new',
  responses: 3,
  lastSeen: null,
  requests: 2,
  paired: 1,
  parser: false,
  tables: [],
  screens: ['daily / open map'],
  verdictStatus: null,
  verdict: null,
  note: null,
  responseShape: { _id: 'integer' },
  requestShape: { viewLvl: 'integer' },
  ...over,
});

describe('catalog view', () => {
  it('filters by command, screen, table and verdict', () => {
    expect(matches(entry(), 'WORLD')).toBe(true);
    expect(matches(entry(), 'open map')).toBe(true);
    expect(matches(entry({ tables: ['player_snapshots'] }), 'player_snap')).toBe(true);
    expect(matches(entry({ verdictStatus: 'rejected' }), 'rejected')).toBe(true);
    expect(matches(entry(), 'zzz')).toBe(false);
    expect(matches(entry(), '  ')).toBe(true);
  });

  it('renders text, never markup', () => {
    const table = renderCatalog([entry({ command: '<img src=x onerror=alert(1)>' })]);
    expect(table.querySelector('img')).toBeNull();
    expect(table.textContent).toContain('<img src=x');
  });

  it('shows a dash for pairing when no request was seen and omits missing shapes', () => {
    const table = renderCatalog([entry({ requests: 0, requestShape: null })]);
    const cells = Array.from(table.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(cells[3]).toBe('—');
    expect(table.querySelectorAll('details')).toHaveLength(1);
  });
});
