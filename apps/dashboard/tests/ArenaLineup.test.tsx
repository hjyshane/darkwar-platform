// The decoded defence lineup, on screen. The protocol carries no hero names,
// so the cell leads with the troop class — which is the thing you counter —
// and keeps the hero id in the tooltip.
import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type ArenaEntryRow, ArenaTable } from '../src/features/arena/ArenaTable';
import { LineupCell } from '../src/features/arena/LineupCell';
import {
  type LineupHero,
  bySlot,
  composition,
  troopClassInitial,
  troopClassName,
} from '../src/lib/troops';
import { renderWithQuery } from './renderWithQuery';

/** jsdom does not toggle a <details> from a summary click, so the state is
 * set directly and the toggle event fired on the element React listens on. */
function expand(): void {
  const details = document.querySelector('details') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

const FIGHTER = 1;
const SHOOTER = 2;
const RIDER = 3;

function hero(over: Partial<LineupHero> & Pick<LineupHero, 'slot' | 'hero_id'>): LineupHero {
  return {
    troop_class: FIGHTER,
    hero_level: 103,
    level_synced: false,
    star: 6,
    hero_power: 6_731_000,
    weapon_level: null,
    skills: [],
    equipment: [],
    ...over,
  };
}

const lineup: LineupHero[] = [
  hero({
    slot: 3,
    hero_id: 40001,
    weapon_level: 26,
    skills: [
      { skill_id: 10042150, level: 15 },
      { skill_id: 10042250, level: 10 },
    ],
    equipment: [
      { equipment_id: 410100, level: 100, step: 11 },
      { equipment_id: 410200, level: 70, step: 5 },
    ],
  }),
  hero({ slot: 1, hero_id: 40002, troop_class: SHOOTER, hero_power: 7_031_800 }),
  hero({ slot: 2, hero_id: 21001, troop_class: SHOOTER, hero_power: 6_929_350 }),
  hero({ slot: 5, hero_id: 11001, troop_class: SHOOTER, hero_power: 4_535_500 }),
  hero({ slot: 4, hero_id: 1004, star: 5, hero_power: 6_305_850 }),
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
  const odd = [...lineup, hero({ slot: null, hero_id: 33003, troop_class: RIDER, star: 4 })];

  expect(bySlot(odd)).toHaveLength(6);
  expect(bySlot(odd).at(-1)?.hero_id).toBe(33003);
});

test('the cell names the hero, its class and its level in the tooltip', () => {
  renderWithQuery(<LineupCell heroes={lineup} />);

  expect(screen.getByTitle(/Slot 3 · Hero 40001 · Fighter · Lv 103 · 6★/)).toBeDefined();
});

test('expanding shows weapon, gear and skills, not just the roster', () => {
  renderWithQuery(<LineupCell heroes={lineup} />);
  // The arena screen shows this detail, which is why it was decoded; the
  // collapsed chips alone would throw the reason away.
  expand();

  expect(screen.getByText('Weapon')).toBeDefined();
  expect(screen.getByText('Lv 26')).toBeDefined();
  // Gear and skill levels, joined — the ids are in the tooltip.
  expect(screen.getByText('100 / 70')).toBeDefined();
  expect(screen.getByText('15 / 10')).toBeDefined();
});

test('a training-centre level renders as the plain number it is', () => {
  const synced = [hero({ slot: 1, hero_id: 40001, hero_level: 120, level_synced: true })];
  renderWithQuery(<LineupCell heroes={synced} />);
  expand();

  // The hero really is level 120 — the training centre effect applies — so
  // the cell must not qualify it with a marker or a caveat.
  expect(screen.getByText('120')).toBeDefined();
  expect(screen.queryByText(/120\D/)).toBeNull();
});

test('a hero with no exclusive weapon reads as unknown, not level zero', () => {
  renderWithQuery(<LineupCell heroes={lineup} />);
  expand();

  // Four of the five have none; each renders an em dash rather than "Lv 0".
  expect(screen.queryByText('Lv 0')).toBeNull();
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
