// 0133: a post announces in as many rooms as it needs.
//
// The picker is checkboxes rather than `<select multiple>` because the common
// accident on a multiple select is REPLACING the choice while believing you
// added to it — and this is a form somebody fills in once a week under time
// pressure, announcing to 94 people. So the assertions below are about
// accumulation: ticking a second room must not unpick the first.
//
// The fallback is the other half. "Wherever notices normally go" is a CHOICE
// among the rooms, not the absence of one, so it is a box in the same list —
// and picking it has to clear the rest or the row would name a room and claim
// the default at once.
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ChannelField } from '../src/components/ChannelField';

vi.mock('../src/lib/channels', () => ({
  useChannelNames: () => ({ data: ['general', 'war'] }),
}));

function show(value: string[], onChange = vi.fn()) {
  render(
    <ChannelField
      fallbackLabel="Default for notices"
      id="channels"
      onChange={onChange}
      value={value}
    />,
  );
  return onChange;
}

test('ticking a second room keeps the first', () => {
  const onChange = show(['general']);
  fireEvent.click(screen.getByRole('checkbox', { name: '#war' }));
  expect(onChange).toHaveBeenCalledWith(['general', 'war']);
});

test('unticking a room leaves the others alone', () => {
  const onChange = show(['general', 'war']);
  fireEvent.click(screen.getByRole('checkbox', { name: '#general' }));
  expect(onChange).toHaveBeenCalledWith(['war']);
});

test('the default is what is ticked when nothing else is', () => {
  show([]);
  expect(
    (screen.getByRole('checkbox', { name: 'Default for notices' }) as HTMLInputElement).checked,
  ).toBe(true);
});

test('picking the default clears the rooms', () => {
  const onChange = show(['war']);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Default for notices' }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test('a room the reader cannot list is still shown and still ticked', () => {
  // The row names a channel this reader has no permission to enumerate. Dropping
  // it silently would blank the routing on the next save of an unrelated field —
  // the post would quietly stop announcing where it used to.
  show(['retired-room']);
  expect(
    (screen.getByRole('checkbox', { name: '#retired-room' }) as HTMLInputElement).checked,
  ).toBe(true);
});
