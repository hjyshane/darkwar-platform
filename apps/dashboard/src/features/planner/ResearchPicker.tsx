// Research the way the game's research screen lays it out: one tab per
// category (game_research_tabs, the account's server's tree), every research
// in it with its level now — 0 for one not started — and a target to pick.
// Research the reader hid, or already at its top level, drops out until
// "show hidden" brings it back.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { LevelPicker } from './LevelPicker';
import type { Account } from './accounts';
import { fetchCatalogSubjects, fetchResearchTabs } from './data';
import { useHidden } from './hidden';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

interface PickerProps {
  account: Account;
  levels: Readonly<Record<string, number>>;
  tiers: Tiers;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
  onCurrent?: (subject: string, level: number) => void;
}

export function ResearchPicker({ account, levels, tiers, targets, onSet, onCurrent }: PickerProps) {
  const tabs = useQuery({
    queryKey: ['planner-research-tabs', account.serverId],
    queryFn: () => fetchResearchTabs(account.serverId),
    staleTime: 60 * 60_000,
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const tab = chosen ?? tabs.data?.[0]?.tabId;
  const subjects = useQuery({
    queryKey: ['planner-catalog', 'research', tab],
    queryFn: () => fetchCatalogSubjects('research', { category: tab }),
    enabled: tab !== undefined,
    staleTime: 60 * 60_000,
  });
  const [hidden, toggleHidden] = useHidden('planner-hidden-research');
  const [showHidden, setShowHidden] = useState(false);

  if (tabs.isPending) return <p className="empty">Loading research…</p>;
  if (tabs.isError) return <p className="error">{tabs.error.message}</p>;

  // Started research first, then by name: what the account is working on
  // is what it plans next.
  // Maxed hides itself, but not while levels are being typed in (as for
  // buildings).
  const isHidden = (subject: string, max: number) =>
    hidden.has(subject) || (!onCurrent && (levels[subject] ?? 0) >= max);
  const all = subjects.data ?? [];
  const hiddenCount = all.filter((s) => isHidden(s.subject, s.maxLevel)).length;
  const rows = all
    .filter((s) => showHidden || !isHidden(s.subject, s.maxLevel))
    .sort(
      (a, b) =>
        Number((levels[b.subject] ?? 0) > 0) - Number((levels[a.subject] ?? 0) > 0) ||
        a.name.localeCompare(b.name),
    );
  return (
    <>
      <Tabs
        label="Research tab"
        className="planner-tabs"
        items={tabs.data.map((t) => ({ id: t.tabId, label: t.name }))}
        value={tab}
        onChange={setChosen}
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
      {subjects.isPending && <p className="empty loading">Loading…</p>}
      {subjects.isError && <p className="error">{subjects.error.message}</p>}
      {subjects.data && (
        <div className="table-wrap" role="tabpanel">
          <table className="compact planner-pick">
            <thead>
              <tr>
                <th className="label" scope="col">
                  Research
                </th>
                <th scope="col">Level</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const current = levels[s.subject] ?? 0;
                return (
                  <tr
                    className={isHidden(s.subject, s.maxLevel) ? 'pack-hidden' : undefined}
                    key={s.subject}
                  >
                    <td className="label">
                      {s.name} <span className="subtle">/ {s.maxLevel}</span>
                    </td>
                    <td>
                      <LevelPicker
                        current={current}
                        label={s.name}
                        max={s.maxLevel}
                        onCurrent={onCurrent && ((level) => onCurrent(s.subject, level))}
                        onChange={(to) =>
                          onSet({
                            kind: 'research',
                            subject: s.subject,
                            name: s.name,
                            from: current,
                            to,
                          })
                        }
                        subject={s.subject}
                        target={targets.get(targetKey('research', s.subject))?.to}
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
      )}
    </>
  );
}
