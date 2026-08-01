// The decoded defence lineup, on screen. The protocol carries no hero names,
// so the cell leads with the troop class — which is the thing you counter —
// and keeps the hero id in the tooltip.
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type ArenaEntryRow, ArenaTable } from '../src/features/arena/ArenaTable';
import { LineupCell } from '../src/features/arena/LineupCell';
import { bySlot, composition, troopClassInitial, troopClassName } from '../src/lib/troops';
import { renderWithQuery } from './renderWithQuery';

const FIGHTER = 1;
const SHOOTER = 2;
const RIDER = 3;

const lineup = [
  { slot: 3, hero_id: 40001, troop_class: FIGHTER, star: 6, hero_power: 6_731_000 },
  { slot: 1, hero_id: 40002, troop_class: SHOOTER, star: 6, hero_power: 7_031_800 },
  { slot: 2, hero_id: 21001, troop_class: SHOOTER, star: 6, hero_power: 6_929_350 },
  { slot: 5, hero_id: 11001, troop_class: SHOOTER, star: 6, hero_power: 4_535_500 },
  { slot: 4, hero_id: 1004, troop_class: FIGHTER, star: 5, hero_power: 6_305_850 },
];

test('composition counts the classes, most common first', () => {
  expect(composition(lineup)).toBe('3 Shooter · 2 Fighter');
});

test('an unobserved class is reported, not silently folded in', () => {
  expect(troopClassName(9)).toBe('Class 9');
  expect(troopClassName(null)).toBe('Unknown');
  expect(troopClassInitial(null)).toBe('?');
});

test('chips render in slot order, not payload order', () => {
  expect(bySlot(lineup).map((hero) => hero.slot)).toEqual([1, 2, 3, 4, 5]);
});

test('a hero with no slot still renders rather than being dropped', () => {
  const odd = [
    ...lineup,
    { slot: null, hero_id: 33003, troop_class: RIDER, star: 4, hero_power: 1 },
  ];

  expect(bySlot(odd)).toHaveLength(6);
  expect(bySlot(odd).at(-1)?.hero_id).toBe(33003);
});

test('the cell names the hero and its class in the tooltip', () => {
  renderWithQuery(<LineupCell heroes={lineup} />);

  expect(screen.getByTitle(/Slot 3 · Hero 40001 · Fighter · 6★/)).toBeDefined();
});

test('no lineup reads as unknown, not as an empty team', () => {
  const { container } = renderWithQuery(<LineupCell heroes={[]} />);

  expect(container.textContent).toBe('—');
  expect(container.querySelectorAll('.chip')).toHaveLength(0);
});

const header = {
  snapshot_id: 'h1',
  week_start: '2026-07-27T02:00:00Z',
  captured_at: '2026-07-27T23:40:00Z',
  entry_count: 2,
};

const entries: ArenaEntryRow[] = [
  {
    snapshot_id: 'e1',
    rank: 1,
    name: 'Arena001',
    game_uid: 9259969116000582,
    server_id: 582,
    alliance_name: 'Alliance01',
    alliance_code: 'A001',
    score: 2000,
    defense_power: 460_124_336,
    lineup,
    composition: composition(lineup),
  },
  {
    snapshot_id: 'e2',
    rank: 2,
    name: 'Arena002',
    game_uid: 9105284188000580,
    server_id: 580,
    alliance_name: null,
    alliance_code: null,
    score: null,
    defense_power: null,
    lineup: [],
    composition: '',
  },
];

test('the arena table shows a lineup per entry', () => {
  renderWithQuery(<ArenaTable entries={entries} header={header} />);

  expect(screen.getByText('Lineup')).toBeDefined();
  // Five chips for the entry that has a lineup, none for the one that does not.
  expect(document.querySelectorAll('.chip')).toHaveLength(5);
});

test('composition is searchable, which is the point of precomputing it', () => {
  renderWithQuery(<ArenaTable entries={entries} header={header} />);

  // The field is in SEARCH_FIELDS, so a class name narrows the board to the
  // teams built around it.
  const row = entries.filter((entry) => entry.composition.toLowerCase().includes('shooter'));
  expect(row.map((entry) => entry.snapshot_id)).toEqual(['e1']);
});
