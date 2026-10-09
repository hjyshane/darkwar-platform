import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableView } from '../src/lib/useTableView';

const rows = Array.from({ length: 120 }, (_, index) => ({ n: index + 1, name: `p${index + 1}` }));
const FIELDS = ['name'] as const;

describe('useTableView paging', () => {
  it('slices into pages and clamps a page past the end', () => {
    const { result } = renderHook(() =>
      useTableView(rows, FIELDS, { key: 'n', direction: 'asc' }, 50),
    );
    expect(result.current.pageCount).toBe(3);
    expect(result.current.pageRows.map((row) => row.n)[0]).toBe(1);
    expect(result.current.pageRows).toHaveLength(50);
    act(() => result.current.setPage(3));
    expect(result.current.pageRows).toHaveLength(20);
    act(() => result.current.setPage(9));
    expect(result.current.page).toBe(3);
  });

  it('returns to page 1 on a new search, and does not page when no size is given', () => {
    const paged = renderHook(() => useTableView(rows, FIELDS, null, 50));
    act(() => paged.result.current.setPage(2));
    act(() => paged.result.current.setQuery('p1'));
    expect(paged.result.current.page).toBe(1);
    const whole = renderHook(() => useTableView(rows, FIELDS));
    expect(whole.result.current.pageRows).toHaveLength(120);
    expect(whole.result.current.pageCount).toBe(1);
  });
});
