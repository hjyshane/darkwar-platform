import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogueFrom } from '../sections/itemRef';
import { ItemPicker } from './ItemPicker';
import { SectionForm } from './SectionForms';

afterEach(cleanup);

const catalogue = catalogueFrom({
  items: [{ item_id: '253042', name: 'Orange Hero Shard' }],
});
const common = { catalogue, iconSrc: new Map<string, string>() };

describe('NotesForm', () => {
  it('typing reports the whole payload, Korean field untouched', () => {
    const onChange = vi.fn();
    render(
      <SectionForm
        {...common}
        kind="notes"
        onChange={onChange}
        payload={{ text: '', text_ko: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenCalledWith({ text: 'Hello', text_ko: null });
  });
});

describe('SourcesForm', () => {
  it('Add row appends an empty row and keeps the totals', () => {
    const onChange = vi.fn();
    render(
      <SectionForm
        {...common}
        kind="sources"
        onChange={onChange}
        payload={{ rows: [], total_cap: 170, note: 'x' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(onChange).toHaveBeenCalledWith({
      rows: [{ source: '', rate: '', cap: null }],
      total_cap: 170,
      note: 'x',
    });
  });
});

describe('PrepForm', () => {
  const payload = {
    items: [{ item_ref: { kind: 'item' as const, id: '253042' }, unit: 1, cap: 412, day: 2 }],
  };

  it('clearing the cap removes it, it does not save a zero', () => {
    const onChange = vi.fn();
    render(<SectionForm {...common} kind="prep" onChange={onChange} payload={payload} />);
    fireEvent.change(screen.getByLabelText('Cap, row 1'), { target: { value: '' } });
    const next = onChange.mock.calls[0]?.[0] as typeof payload;
    expect(next.items[0]).toEqual({ item_ref: { kind: 'item', id: '253042' }, unit: 1, day: 2 });
    expect('cap' in (next.items[0] as object)).toBe(false);
  });

  it('shows the chosen item by name', () => {
    render(<SectionForm {...common} kind="prep" onChange={() => {}} payload={payload} />);
    expect(screen.getByText('Orange Hero Shard')).toBeTruthy();
  });

  it('text in a number field is passed on as not-a-number, never dropped', () => {
    const onChange = vi.fn();
    render(<SectionForm {...common} kind="prep" onChange={onChange} payload={payload} />);
    fireEvent.change(screen.getByLabelText('Cap, row 1'), { target: { value: 'lots' } });
    const next = onChange.mock.calls[0]?.[0] as typeof payload;
    expect(Number.isNaN(next.items[0]?.cap)).toBe(true);
  });
});

describe('PointTableForm', () => {
  it('a blank day is the importer’s null day', () => {
    const onChange = vi.fn();
    render(
      <SectionForm
        {...common}
        kind="point_table"
        onChange={onChange}
        payload={{ day: 3, theme: 'Gather', rows: [] }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ day: null, theme: 'Gather', rows: [] });
  });
});

describe('ItemPicker', () => {
  it('searches after typing and chooses a result', async () => {
    const search = vi.fn().mockResolvedValue([
      { ref: { kind: 'item', id: '253042' }, name: 'Orange Hero Shard' },
      { ref: { kind: 'resource', id: '25' }, name: 'Wood' },
    ]);
    const onChange = vi.fn();
    render(<ItemPicker {...common} id="pick" onChange={onChange} search={search} value={null} />);
    fireEvent.change(screen.getByLabelText('Find an item'), { target: { value: 'shard' } });
    const result = await screen.findByRole('button', { name: /Orange Hero Shard/ });
    fireEvent.click(result);
    expect(search).toHaveBeenCalledWith('shard');
    expect(onChange).toHaveBeenCalledWith({ kind: 'item', id: '253042' });
  });

  it('sends nothing for a single letter, and cleans filter syntax first', async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(<ItemPicker {...common} id="pick" onChange={() => {}} search={search} value={null} />);
    const box = screen.getByLabelText('Find an item');
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.change(box, { target: { value: 'x),or(y' } });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('x or y');
  });

  it('shows the chosen item as a chip with a Clear button', () => {
    const onChange = vi.fn();
    render(
      <ItemPicker
        {...common}
        id="pick"
        onChange={onChange}
        search={vi.fn()}
        value={{ kind: 'item', id: '253042' }}
      />,
    );
    expect(screen.getByText('Orange Hero Shard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear item' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
