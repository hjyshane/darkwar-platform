import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type StepColumn, StepTable } from './StepTable';

afterEach(cleanup);

interface Row {
  step: string;
  wood: string;
}

const cols: readonly StepColumn<Row>[] = [
  { key: 'step', header: 'HQ', cell: (r) => r.step },
  { key: 'wood', header: 'Wood', cell: (r) => r.wood, numeric: true },
];

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ step: `${i} → ${i + 1}`, wood: `${i}M` }));

const key = (r: Row) => r.step;

describe('StepTable', () => {
  it('shows every row and no fold control at exactly the threshold', () => {
    const { container } = render(
      <StepTable columns={cols} foldAt={5} rowKey={key} rows={rows(5)} />,
    );
    expect(container.querySelectorAll('tbody tr').length).toBe(5);
    expect(container.querySelector('.step-fold')).toBeNull();
  });

  it('folds past the threshold and unfolds on click', () => {
    const { container } = render(
      <StepTable columns={cols} foldAt={5} rowKey={key} rows={rows(6)} />,
    );
    expect(container.querySelectorAll('tbody tr').length).toBe(5);
    const fold = container.querySelector('.step-fold');
    expect(fold?.textContent).toBe('Show all 6');
    if (!fold) throw new Error('no fold control');
    fireEvent.click(fold);
    expect(container.querySelectorAll('tbody tr').length).toBe(6);
    expect(container.querySelector('.step-fold')).toBeNull();
  });

  it('renders the total row in the foot with the numeric class', () => {
    const { container } = render(
      <StepTable
        columns={cols}
        rowKey={key}
        rows={rows(2)}
        total={{ step: 'Total', wood: '1M' }}
      />,
    );
    const foot = container.querySelector('tfoot tr');
    expect(foot?.className).toContain('step-total');
    expect(foot?.querySelector('td.num')?.textContent).toBe('1M');
    expect(foot?.querySelector('td:first-child')?.textContent).toBe('Total');
  });

  it('marks numeric columns in head and body and not the others', () => {
    const { container } = render(<StepTable columns={cols} rowKey={key} rows={rows(1)} />);
    expect(container.querySelector('thead th:nth-child(2)')?.className).toContain('num');
    expect(container.querySelector('thead th:nth-child(1)')?.className).not.toContain('num');
    expect(container.querySelector('tbody td:nth-child(2)')?.className).toContain('num');
  });

  it('defaults the fold threshold to 20 and sets a caption when given', () => {
    const { container } = render(
      <StepTable caption="HQ 1 → 30" columns={cols} rowKey={key} rows={rows(21)} />,
    );
    expect(container.querySelectorAll('tbody tr').length).toBe(20);
    expect(container.querySelector('caption')?.textContent).toBe('HQ 1 → 30');
  });
});
