// Every building the account has, its level now, and a target to pick. On
// an account entered by hand, every building the game has, levels editable.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LevelPicker } from './LevelPicker';
import { fetchCatalogSubjects } from './data';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

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

  if (subjects.isPending) return <p className="empty">Loading buildings…</p>;
  if (subjects.isError) return <p className="error">{subjects.error.message}</p>;

  const rows = subjects.data
    .filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <input
        aria-label="Find a building"
        className="planner-filter"
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a building…"
        type="search"
        value={filter}
      />
      <div className="table-wrap">
        <table className="compact planner-pick">
          <thead>
            <tr>
              <th className="label" scope="col">
                Building
              </th>
              <th scope="col">Level</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const current = levels[s.subject] ?? 0;
              return (
                <tr key={s.subject}>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">No building matches.</p>}
    </>
  );
}
