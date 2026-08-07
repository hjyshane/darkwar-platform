// The alliance page's member list. It was three hand-written headers with no
// sorting at all — the one member-facing table where clicking a column did
// nothing.
import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  type AllianceMemberRow,
  AllianceMemberTable,
} from '../src/features/alliance/AllianceMemberTable';
import { renderWithQuery } from './renderWithQuery';

const members: AllianceMemberRow[] = [
  { playerId: 'p1', name: 'Middle', gameUid: 5_800_001, power: 200, hqLevel: 30 },
  { playerId: 'p2', name: 'Strongest', gameUid: 5_800_002, power: 300, hqLevel: 25 },
  // No player row: in the alliance, counted, but there is no page to link to.
  { playerId: null, name: null, gameUid: 5_800_003, power: 100, hqLevel: null },
];

function names(): string[] {
  return Array.from(document.querySelectorAll('tbody tr td.label')).map(
    (cell) => cell.textContent ?? '',
  );
}

test('the rows arrive in the order the query returned — power, strongest first', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  expect(names()).toEqual(['Strongest', 'Middle', 'UID 5800003']);
});

test('the power header says so rather than showing an unsorted arrow', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  const header = screen.getByRole('columnheader', { name: /Power/ });
  expect(header.getAttribute('aria-sort')).toBe('descending');
});

test('clicking a header sorts by it', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  fireEvent.click(screen.getByRole('button', { name: /HQ/ }));
  // Ascending first, and the unknown HQ does not read as the lowest level.
  expect(names()[0]).toBe('Middle');
});

test('a member with no player row is listed but not linked', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  const cell = screen.getByText('UID 5800003');
  expect(cell.querySelector('a')).toBeNull();
  expect(screen.getByText('Strongest').tagName).toBe('A');
});

test('unknown values render as unknown, never as zero', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  expect(screen.getAllByText('—').length).toBe(1);
  expect(screen.queryByText('0')).toBeNull();
});

test('search filters the list and says how many are left', () => {
  renderWithQuery(<AllianceMemberTable members={members} />);
  fireEvent.change(screen.getByLabelText(/Search members/i), { target: { value: 'Strong' } });
  expect(names()).toEqual(['Strongest']);
});
