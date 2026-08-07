// The shared column arrangement, from the component every table but the roster
// now renders through. The roster keeps its own markup (it draws a heading row
// between rank groups) and has its own tests; this file covers the path the
// other five take.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ArrangedTable, type Column } from '../src/components/ArrangedTable';
import { MAX_COLUMN_WIDTH, type TableLayouts } from '../src/lib/tableLayout';

interface Row {
  id: string;
  name: string;
  power: number;
  kills: number;
}

const rows: Row[] = [
  { id: 'a', name: 'SyntheticPlayer01', power: 200, kills: 10 },
  { id: 'b', name: 'SyntheticPlayer02', power: 100, kills: 20 },
];

const columns: Column<Row>[] = [
  { id: 'name', label: 'Name', fixed: true, className: 'label', cell: (row) => row.name },
  { id: 'power', label: 'Power', numeric: true, sortKey: 'power', cell: (row) => row.power },
  { id: 'kills', label: 'Kills', numeric: true, sortKey: 'kills', cell: (row) => row.kills },
];

function renderWith(layout: TableLayouts) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The same cache key the hook reads, so this exercises the wiring rather than a
  // stubbed hook.
  client.setQueryData(['table-layout'], layout);
  return render(
    <QueryClientProvider client={client}>
      <ArrangedTable columns={columns} rowKey={(row) => row.id} rows={rows} tableId="demo" />
    </QueryClientProvider>,
  );
}

function headers(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map((cell) =>
    (cell.textContent ?? '').replace(/[↕↑↓▲▼]/g, '').trim(),
  );
}

test('with no arrangement the declared order is what renders', () => {
  renderWith({});
  expect(headers()).toEqual(['Name', 'Power', 'Kills']);
});

test('a saved order moves columns, and an unmentioned one keeps its place', () => {
  // `kills` is not in the stored order — the failure this shape exists to avoid
  // is a saved list swallowing every column added after it was saved.
  renderWith({ demo: { order: ['power', 'name'] } });
  expect(headers()).toEqual(['Power', 'Name', 'Kills']);
});

test('a hidden column leaves the table, header and cells together', () => {
  renderWith({ demo: { hidden: ['kills'] } });
  expect(headers()).toEqual(['Name', 'Power']);
  expect(screen.queryByText('20')).toBeNull();
  expect(document.querySelectorAll('tbody tr')[0]?.children.length).toBe(2);
});

test('a fixed column is shown even when the setting says to hide it', () => {
  // `hidden` is free text in a JSON settings row, so the refusal belongs here
  // rather than in the form. Hiding the name leaves figures belonging to nobody.
  renderWith({ demo: { hidden: ['name'] } });
  expect(headers()).toContain('Name');
});

test('a saved width reaches the colgroup, clamped', () => {
  renderWith({ demo: { width: { power: 4000, kills: 120 } } });
  const widths = Array.from(document.querySelectorAll('colgroup col')).map(
    (col) => (col as HTMLElement).style.width,
  );
  expect(widths).toContain('120px');
  expect(widths).toContain(`${MAX_COLUMN_WIDTH}px`);
});

// Without `onSort` every header is plain, whatever `sortKey` says — a table that
// does not sort must not draw controls that do nothing.
test('no sort handler means no sort buttons', () => {
  renderWith({});
  expect(document.querySelectorAll('thead button').length).toBe(0);
});

test('one arrangement does not leak into another table', () => {
  renderWith({ other: { hidden: ['power'] } });
  expect(headers()).toEqual(['Name', 'Power', 'Kills']);
});
