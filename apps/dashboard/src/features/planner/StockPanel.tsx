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

async function fetchMaterials(): Promise<Material[]> {
  const { data, error } = await supabase
    .from('game_upgrade_materials')
    .select('type, id, kinds')
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((m) => (m.type === 'resource' || m.type === 'item') && m.id !== null)
    .filter((m) => !LEFT_OUT.has(`${m.type}:${m.id}`))
    .map((m) => ({ type: m.type as Material['type'], id: m.id as string, kinds: m.kinds ?? [] }));
}

/** Where a material shows up, in the order a player thinks of it. */
const GROUPS: ReadonlyArray<[string, (m: Material) => boolean]> = [
  ['Resources', (m) => m.type === 'resource'],
  ['Buildings', (m) => m.kinds.includes('building')],
  ['Research', (m) => m.kinds.includes('research')],
  ['Heroes and gear', (m) => m.kinds.includes('hero_gear') || m.kinds.includes('hero')],
  ['Exclusive weapons', (m) => m.kinds.includes('exclusive')],
  ['Vehicle', (m) => m.kinds.includes('vehicle_part')],
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

  return (
    <details className="planner-stock" open>
      <summary>
        <h3>Stock</h3>
        <span className="subtle">
          {' '}
          everything an upgrade costs, and how much you hold — change any figure
        </span>
      </summary>
      <input
        aria-label="Find a material"
        className="planner-filter"
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a material…"
        type="search"
        value={filter}
      />
      {sections.map(([label, rows]) => (
        <section className="planner-stock-group" key={label}>
          <h4>{label}</h4>
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
