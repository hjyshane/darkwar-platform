import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './Select';
import { edgeIndex, moveActive, optionsFromChildren, typeaheadIndex } from './selectLogic';

const opts = optionsFromChildren(
  <>
    <option value="a">Alpha</option>
    <option value="b" disabled>
      Beta
    </option>
    <option value="c">Gamma</option>
    <option value="d">Delta</option>
  </>,
);

describe('selectLogic', () => {
  it('reads option children, value defaulting to the text', () => {
    expect(opts.map((o) => o.value)).toEqual(['a', 'b', 'c', 'd']);
    expect(optionsFromChildren(<option>Plain</option>)[0]?.value).toBe('Plain');
    expect(optionsFromChildren([<option key="1">x{1}</option>])[0]?.text).toBe('x1');
  });
  it('skips disabled options when moving and stops at the ends', () => {
    expect(moveActive(opts, 0, 1)).toBe(2);
    expect(moveActive(opts, 2, -1)).toBe(0);
    expect(moveActive(opts, 0, -1)).toBe(0);
    expect(moveActive(opts, 3, 1)).toBe(3);
  });
  it('finds the first and last enabled option', () => {
    expect(edgeIndex(opts, 'first')).toBe(0);
    expect(edgeIndex(opts, 'last')).toBe(3);
    expect(edgeIndex([], 'first')).toBe(-1);
  });
  it('typeahead matches by prefix, skips disabled, and cycles a repeated letter', () => {
    expect(typeaheadIndex(opts, 0, 'g')).toBe(2);
    expect(typeaheadIndex(opts, 0, 'b')).toBe(-1);
    expect(typeaheadIndex(opts, 0, 'zz')).toBe(-1);
    const twin = optionsFromChildren(
      <>
        <option>Sun</option>
        <option>Sat</option>
        <option>Mon</option>
      </>,
    );
    expect(typeaheadIndex(twin, 0, 's')).toBe(1);
    expect(typeaheadIndex(twin, 1, 'ss')).toBe(0);
    expect(typeaheadIndex(twin, 0, 'sa')).toBe(1);
  });
});

function setup(onChange = vi.fn()) {
  render(
    <Select aria-label="Server" onChange={onChange} value="a">
      <option value="a">Alpha</option>
      <option value="c">Gamma</option>
      <option value="d">Delta</option>
    </Select>,
  );
  return { onChange, trigger: screen.getByRole('combobox', { name: 'Server' }) };
}

describe('Select', () => {
  afterEach(cleanup);

  it('shows the selected label and opens a listbox on click', () => {
    const { trigger } = setup();
    expect(trigger.textContent).toBe('Alpha');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
  it('chooses with the keyboard and reports the value', () => {
    const { trigger, onChange } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('chooses by clicking an option, and not when it is already selected', () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('option')[2] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('d');
  });
  it('closes on Escape without choosing', () => {
    const { trigger, onChange } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('closes on a press outside', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
