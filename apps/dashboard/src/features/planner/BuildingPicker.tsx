// Every building the account has, its level now, and a target to pick. On
// an account entered by hand, every building the game has, levels editable.
//
// Left out: buildings the game never upgrades — a highest level of 1 (Truck,
// Road, Helipad, City Plaza, Arena, Emergency Center, Fishing Pier, Special
// Ops Outpost, the workshops that are only placed) — and the Formations,
// whose 200 rows are not something a player raises (user, 2026-10-04).
// Hidden by the reader, or already at the top, a building drops out too;
// "show hidden" brings them back.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LevelPicker } from './LevelPicker';
import { fetchCatalogSubjects } from './data';
import { useHidden } from './hidden';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

/** Formation I-IV: 200 levels in the client, none a player builds. */
const NOT_UPGRADED = new Set(['427000', '793000', '794000', '795000']);

interface PickerProps {
  levels: Readonly<Record<string, number>>;
  tiers: Tiers;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
  onCurrent?: (subject: string, level: number) => void;
}

export function BuildingPicker({ levels, tiers, targets, onSet, onCurrent }: PickerProps) {
  // By hand, every building is offered; from a login, the ones it has.
  const ids = onCurrent ? [] : Object.keys(levels);
  const subjects = useQuery({
    queryKey: ['planner-catalog', 'building', onCurrent ? '*' : ids.join(',')],
    queryFn: () => fetchCatalogSubjects('building', onCurrent ? {} : { subjects: ids }),
    staleTime: 60 * 60_000,
  });
  const [filter, setFilter] = useState('');
  const [hidden, toggleHidden] = useHidden('planner-hidden-buildings');
  const [showHidden, setShowHidden] = useState(false);

  if (subjects.isPending) return <p className="empty">Loading buildings…</p>;
  if (subjects.isError) return <p className="error">{subjects.error.message}</p>;

  const upgradable = subjects.data.filter((s) => s.maxLevel > 1 && !NOT_UPGRADED.has(s.subject));
  // Maxed hides itself, but not while levels are being typed in: setting a
  // building to its top level must not make it vanish under the cursor.
  const isHidden = (subject: string, max: number) =>
    hidden.has(subject) || (!onCurrent && (levels[subject] ?? 0) >= max);
  const hiddenCount = upgradable.filter((s) => isHidden(s.subject, s.maxLevel)).length;
  const rows = upgradable
    .filter((s) => showHidden || !isHidden(s.subject, s.maxLevel))
    .filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="row">
        <input
          aria-label="Find a building"
          className="planner-filter"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a building…"
          type="search"
          value={filter}
        />
        {hiddenCount > 0 && (
          <label className="subtle">
            <input
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              type="checkbox"
            />{' '}
            show hidden and maxed ({hiddenCount})
          </label>
        )}
      </div>
      <div className="table-wrap">
        <table className="compact planner-pick">
          <thead>
            <tr>
              <th className="label" scope="col">
                Building
              </th>
              <th scope="col">Level</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const current = levels[s.subject] ?? 0;
              const off = isHidden(s.subject, s.maxLevel);
              return (
                <tr className={off ? 'pack-hidden' : undefined} key={s.subject}>
                  <td className="label">{s.name}</td>
                  <td>
                    <LevelPicker
                      current={current}
                      label={s.name}
                      max={s.maxLevel}
                      onCurrent={onCurrent && ((level) => onCurrent(s.subject, level))}
                      onChange={(to) =>
                        onSet({
                          kind: 'building',
                          subject: s.subject,
                          name: s.name,
                          from: current,
                          to,
                        })
                      }
                      subject={s.subject}
                      target={targets.get(targetKey('building', s.subject))?.to}
                      tiers={tiers}
                    />
                  </td>
                  <td>
                    <button
                      className="link-button muted"
                      onClick={() => toggleHidden(s.subject)}
                      type="button"
                    >
                      {hidden.has(s.subject) ? 'unhide' : 'hide'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">No building to show.</p>}
    </>
  );
}
