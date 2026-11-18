// The Black Gold battlefield: what is on it and where, as static data.
//
// SOURCE: the in-game event text and minimap, supplied by the owner as
// screenshots (2026-11-18). NOT read from capture — nothing on the wire
// describes the map — so every figure here is as the game's own screen shows it
// and is one place to fix when the game changes.
//
// THE MAP IS POINT-SYMMETRIC about its centre (owner, 2026-11-18), so only one
// half is written down and the other is its reflection. Positions are 0–1
// across a square, y down, drawn with OUR headquarters at the bottom left.
// Which corner is ours varies per battle; the picture rotates half a turn for
// the other case, and an objective keeps the same id either way because ids
// say what it is relative to us, not which corner of the screen it is in.

export type ObjectiveKind = 'headquarters' | 'military' | 'hospital' | 'refinery' | 'factory';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  label: string;
  /** Position with our headquarters at the bottom left, 0–1, y down. */
  x: number;
  y: number;
}

/** Half the map; `reflect` writes the other half. Measured off the minimap. */
const HALF: ReadonlyArray<Omit<Objective, 'label'> & { label: string; partner?: string }> = [
  {
    id: 'hq-ours',
    kind: 'headquarters',
    label: 'Our headquarters',
    x: 0.16,
    y: 0.85,
    partner: 'hq-theirs',
  },
  { id: 'mil-a', kind: 'military', label: 'Military Base A', x: 0.2, y: 0.2, partner: 'mil-b' },
  {
    id: 'hosp-ours',
    kind: 'hospital',
    label: 'Field Hospital (our side)',
    x: 0.5,
    y: 0.76,
    partner: 'hosp-theirs',
  },
  { id: 'oil-1', kind: 'refinery', label: 'Oil Refinery 1', x: 0.37, y: 0.64, partner: 'oil-4' },
  { id: 'oil-2', kind: 'refinery', label: 'Oil Refinery 2', x: 0.2, y: 0.51, partner: 'oil-5' },
  { id: 'oil-3', kind: 'refinery', label: 'Oil Refinery 3', x: 0.35, y: 0.36, partner: 'oil-6' },
];

const NAMES: Record<string, string> = {
  'hq-theirs': 'Their headquarters',
  'mil-b': 'Military Base B',
  'hosp-theirs': 'Field Hospital (their side)',
  'oil-4': 'Oil Refinery 4',
  'oil-5': 'Oil Refinery 5',
  'oil-6': 'Oil Refinery 6',
};

/** Every objective, ours-first, with the reflected half filled in. */
export const OBJECTIVES: readonly Objective[] = [
  ...HALF.map(({ partner: _partner, ...own }) => own),
  { id: 'factory', kind: 'factory', label: 'Rare Earth Factory', x: 0.5, y: 0.5 },
  ...HALF.flatMap(({ partner, kind, x, y }) =>
    partner === undefined
      ? []
      : [{ id: partner, kind, label: NAMES[partner] ?? partner, x: 1 - x, y: 1 - y }],
  ),
];

/** Where an objective is drawn when our headquarters is at the top right. */
export function placed(objective: Objective, oursAtTopRight: boolean): { x: number; y: number } {
  return oursAtTopRight
    ? { x: 1 - objective.x, y: 1 - objective.y }
    : { x: objective.x, y: objective.y };
}

export interface ObjectiveFacts {
  kind: ObjectiveKind;
  name: string;
  count: number;
  /** One line each; the figures are the game's own text. */
  first: string;
  sustained: string;
  note: string;
}

/** The reference table beside the map. Alliance / personal points. */
export const OBJECTIVE_FACTS: readonly ObjectiveFacts[] = [
  {
    kind: 'military',
    name: 'Military Base',
    count: 2,
    first: '5,000 / 2,500',
    sustained: '+1,000 / +500 per min',
    note: 'Capture buff: troop damage +20%. Contestable only after a delay.',
  },
  {
    kind: 'hospital',
    name: 'Field Hospital',
    count: 2,
    first: '5,000 / 2,500',
    sustained: '+1,000 / +500 per min',
    note: 'Capture buff: wound healing speed +50%. Contestable only after a delay.',
  },
  {
    kind: 'refinery',
    name: 'Oil Refinery',
    count: 6,
    first: '2,000 / 1,000',
    sustained: '+400 / +200 per min',
    note: 'Hold as many as possible.',
  },
  {
    kind: 'factory',
    name: 'Rare Earth Factory',
    count: 1,
    first: '—',
    sustained: '—',
    note: 'Makes Rare Earth Alloy at 15 min and at 25 min.',
  },
  {
    kind: 'headquarters',
    name: 'Headquarters',
    count: 2,
    first: '—',
    sustained: '—',
    note: 'Deliver Rare Earth Alloy here: 100,000 alliance / 10,000 personal points each.',
  },
];

/** Not on the map as fixed spots, so not plannable as objectives. */
export const SCATTERED_NOTE =
  'Oil Tanks are scattered across the whole map: gathering gives 600 alliance / 60 personal points per minute. Defeating enemy units also scores: 20 for attacking a building, 10 for defending one, 10 in the field, per 10,000 CP beaten.';
