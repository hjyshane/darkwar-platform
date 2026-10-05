// Every material any upgrade costs (game_upgrade_materials, 0229) and how
// much of it the account holds — from its login, or typed here. This is the
// planner's one stock: "What it takes" reads Have and Missing from it.
//
// A login account's edits last for the visit (the login stays the record); a
// hand-entered account's are part of what Save writes.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { GameIcon, useIcons, useItemIcons } from '../../lib/gameIcons';
import { supabase } from '../../lib/supabase';
import { fetchMaterialNames } from './data';
import { exact, short } from './format';

interface Material {
  type: 'resource' | 'item';
  id: string;
  kinds: string[];
}

// Held but never an upgrade cost the planner adds up, so not in
// game_upgrade_materials (user, 2026-10-05): hero fragments (item type 93,
// one per hero), the universal hero fragments (62), and the Universal
// Exclusive Equipment Fragment.
const HERO_FRAGMENT_TYPES = ['93', '62'];
const UNIVERSAL_WEAPON_FRAGMENT = '253094';

async function fetchMaterials(): Promise<Material[]> {
  const [costs, extra] = await Promise.all([
    supabase.from('game_upgrade_materials').select('type, id, kinds').limit(1000),
    supabase
      .from('game_items')
      .select('item_id, item_type, name')
      .or(`item_type.in.(${HERO_FRAGMENT_TYPES.join(',')}),item_id.eq.${UNIVERSAL_WEAPON_FRAGMENT}`)
      .limit(1000),
  ]);
  if (costs.error) throw new Error(costs.error.message);
  if (extra.error) throw new Error(extra.error.message);
  const materials: Material[] = (costs.data ?? [])
    .filter((m) => (m.type === 'resource' || m.type === 'item') && m.id !== null)
    .filter((m) => !LEFT_OUT.has(`${m.type}:${m.id}`))
    .map((m) => ({ type: m.type as Material['type'], id: m.id as string, kinds: m.kinds ?? [] }));
  const known = new Set(materials.map((m) => `${m.type}:${m.id}`));
  for (const row of extra.data ?? []) {
    // "{0} Fragments" rows are templates the client fills in, not items.
    if (known.has(`item:${row.item_id}`) || (row.name ?? '').includes('{0}')) continue;
    materials.push({
      type: 'item',
      id: row.item_id,
      kinds: [row.item_id === UNIVERSAL_WEAPON_FRAGMENT ? 'exclusive' : 'hero_fragment'],
    });
  }
  return materials;
}

// Gear (200034) is a vehicle resource in game; the upgrade data lists only a
// research that costs it, so it would land under Research (user, 2026-10-05).
const VEHICLE_ITEMS = new Set(['200034']);

/** Where a material shows up, in the order a player thinks of it. */
const GROUPS: ReadonlyArray<[string, (m: Material) => boolean]> = [
  ['Resources', (m) => m.type === 'resource'],
  [
    'Vehicle',
    (m) => m.kinds.includes('vehicle_part') || (m.type === 'item' && VEHICLE_ITEMS.has(m.id)),
  ],
  ['Buildings', (m) => m.kinds.includes('building')],
  ['Research', (m) => m.kinds.includes('research')],
  ['Heroes and gear', (m) => m.kinds.includes('hero_gear') || m.kinds.includes('hero')],
  ['Hero fragments', (m) => m.kinds.includes('hero_fragment')],
  ['Exclusive weapons', (m) => m.kinds.includes('exclusive')],
  ['Pets', (m) => m.kinds.includes('pet')],
];

// Costs a planner has no use for (user, 2026-10-05): Crimson Ore and Antigen,
// and the items only the buildings the planner leaves out are paid in —
// Badge, BB-8, Permanent Construction Queue, Skipper, Truth.
const LEFT_OUT = new Set([
  'resource:0',
  'resource:13',
  'item:200017',
  'item:200063',
  'item:200066',
  'item:200061',
  'item:200062',
]);

// Resources in the game's own order: Wood, Iron, Electricity, Food, Coin.
const RESOURCE_ORDER = ['25', '12', '26', '24', '14'];

interface StockPanelProps {
  have: (type: string, id: string) => number;
  onHave: (type: string, id: string, amount: number) => void;
  /** `type:id` of figures typed over the login's. */
  edited: ReadonlySet<string>;
}

// Closed until opened, and remembered (user 2026-10-05: the list pushed
// the rest of the planner down). Browser storage can be refused.
const OPEN_KEY = 'planner-stock-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Not remembered; the panel still works.
  }
}

export function StockPanel({ have, onHave, edited }: StockPanelProps) {
  const materials = useQuery({
    queryKey: ['planner-materials'],
    queryFn: fetchMaterials,
    staleTime: 60 * 60_000,
  });
  const itemIds = (materials.data ?? []).filter((m) => m.type === 'item').map((m) => m.id);
  const names = useQuery({
    queryKey: ['planner-names', itemIds.join(',')],
    queryFn: () => fetchMaterialNames(itemIds),
    enabled: materials.data !== undefined,
    staleTime: 60 * 60_000,
  });
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [open, setOpen] = useState(readOpen);
  const itemIcons = useItemIcons(itemIds);
  const resourceIcons = useIcons('resource');

  if (materials.isPending) return <p className="empty">Loading materials…</p>;
  if (materials.isError) return <p className="error">{materials.error.message}</p>;

  const nameOf = (m: Material) =>
    (m.type === 'item' ? names.data?.items.get(m.id) : names.data?.resources.get(m.id)) ??
    `${m.type} ${m.id}`;
  const needle = filter.trim().toLowerCase();
  const placed = new Set<string>();
  const sections = GROUPS.map(([label, belongs]) => {
    const rows = materials.data
      .filter((m) => !placed.has(`${m.type}:${m.id}`) && belongs(m))
      .filter((m) => needle === '' || nameOf(m).toLowerCase().includes(needle))
      .sort((a, b) =>
        a.type === 'resource' && b.type === 'resource'
          ? RESOURCE_ORDER.indexOf(a.id) - RESOURCE_ORDER.indexOf(b.id)
          : nameOf(a).localeCompare(nameOf(b)),
      );
    for (const m of rows) placed.add(`${m.type}:${m.id}`);
    return [label, rows] as const;
  }).filter(([, rows]) => rows.length > 0);
  const shownGroup = sections.find(([label]) => label === group)?.[0] ?? sections[0]?.[0] ?? null;

  return (
    <details
      className="planner-stock"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        storeOpen(e.currentTarget.open);
      }}
      open={open}
    >
      <summary className="planner-stock-head">
        <span>
          <h3>Stock</h3>
          <span className="subtle">everything an upgrade costs, and how much you hold</span>
        </span>
        <span aria-hidden="true" className="planner-stock-toggle">
          {open ? '▴ Hide' : '▾ Show'}
        </span>
      </summary>
      {/* A tab per category; a search looks through all of them. */}
      <div aria-label="Stock category" className="planner-tabs" role="tablist">
        {sections.map(([label, rows]) => (
          <button
            aria-selected={needle === '' && label === shownGroup}
            key={label}
            onClick={() => {
              setGroup(label);
              setFilter('');
            }}
            role="tab"
            type="button"
          >
            {label} ({rows.length})
          </button>
        ))}
      </div>
      <input
        aria-label="Find a material"
        className="planner-filter"
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a material…"
        type="search"
        value={filter}
      />
      {sections
        .filter(([label]) => needle !== '' || label === shownGroup)
        .map(([label, rows]) => (
          <section className="planner-stock-group" key={label}>
            {needle !== '' && <h4>{label}</h4>}
            <div className="planner-stock-grid">
              {rows.map((m) => {
                const key = `${m.type}:${m.id}`;
                const held = have(m.type, m.id);
                return (
                  <label className="planner-stock-item" key={key}>
                    <span className="planner-stock-name">
                      <GameIcon
                        src={(m.type === 'item' ? itemIcons : resourceIcons).data?.get(m.id)}
                      />
                      {nameOf(m)}
                      {edited.has(key) && (
                        <span className="muted" title="Typed over the login's figure">
                          {' '}
                          ✎
                        </span>
                      )}
                    </span>
                    <span className="planner-stock-figure" title={exact(held)}>
                      {short(held)}
                    </span>
                    <input
                      aria-label={`Have ${nameOf(m)}`}
                      min={0}
                      onChange={(e) => onHave(m.type, m.id, Number(e.target.value) || 0)}
                      type="number"
                      value={held}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
    </details>
  );
}
