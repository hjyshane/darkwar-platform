// Every building the account has, its level now, and a target to pick. On
// an account entered by hand, every building the game has, levels editable.
//
// Left out: buildings the game never upgrades — a highest level of 1 (Truck,
// Road, Helipad, City Plaza, Arena, Emergency Center, Fishing Pier, Special
// Ops Outpost, the workshops that are only placed) — and the Formations,
// whose 200 rows are not something a player raises (user, 2026-10-04).
// Hidden by the reader, or already at the top, a building drops out too;
// "show hidden" brings them back.
//
// Season buildings are left out too: they have their own list in the
// recommendations. And when levels are typed in, the list is the buildings
// accounts actually have (0286), the same set a login lists — not the whole
// catalogue (user, 2026-10-12).

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSeasons } from '../../lib/seasons';
import { LevelPicker } from './LevelPicker';
import { FORMATION_IDS } from './categories';
import { fetchCatalogSubjects, fetchPlannerBuildingIds } from './data';
import { useHidden } from './hidden';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

const NOT_UPGRADED = FORMATION_IDS;

interface PickerProps {
  levels: Readonly<Record<string, number>>;
  tiers: Tiers;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
  onCurrent?: (subject: string, level: number) => void;
}

export function BuildingPicker({ levels, tiers, targets, onSet, onCurrent }: PickerProps) {
  // From a login, the buildings it has. By hand, the buildings accounts have
  // (0286) plus any this one already has a level for. If nobody has logged in
  // yet there is nothing to go on, and the whole catalogue is offered.
  const known = useQuery({
    queryKey: ['planner-building-ids'],
    enabled: onCurrent !== undefined,
    staleTime: 60 * 60_000,
    queryFn: fetchPlannerBuildingIds,
  });
  const settled = onCurrent === undefined || known.isSuccess || known.isError;
  const wide = onCurrent !== undefined && (known.data ?? []).length === 0;
  const ids =
    onCurrent === undefined
      ? Object.keys(levels)
      : [...new Set([...(known.data ?? []), ...Object.keys(levels)])].sort();
  const subjects = useQuery({
    queryKey: ['planner-catalog', 'building', wide ? '*' : ids.join(',')],
    enabled: settled,
    queryFn: () => fetchCatalogSubjects('building', wide ? {} : { subjects: ids }),
    staleTime: 60 * 60_000,
  });
  const [filter, setFilter] = useState('');
  const [hidden, toggleHidden] = useHidden('planner-hidden-buildings');
  const [showHidden, setShowHidden] = useState(false);
  const seasons = useSeasons();
  const seasonIds = useMemo(
    () =>
      new Set((seasons.data ?? []).flatMap((season) => season.buildings.map((b) => String(b.id)))),
    [seasons.data],
  );

  if (subjects.isPending) return <p className="empty">Loading buildings…</p>;
  if (subjects.isError) return <p className="error">{subjects.error.message}</p>;

  const upgradable = subjects.data.filter(
    (s) => s.maxLevel > 1 && !NOT_UPGRADED.has(s.subject) && !seasonIds.has(s.subject),
  );
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
