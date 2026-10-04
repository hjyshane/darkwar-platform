// The material planner (item 4): pick an account, pick what to raise and to
// which level, and read what each costs and what it all costs after that
// account's buffs — and what is still missing from what it holds.
//
// Costs are the game's own (game_upgrade_steps, by the level reached);
// levels, stock and buffs come from the account's newest login (0205,
// 0219, 0221, 0222). Every buff and every stock figure can be overwritten
// here: a presidential buff, an emergency project, or stock that has moved
// since. Nothing typed here is saved.
//
// Picking happens where the thing lives: buildings in a list, research under
// the game's research tabs, heroes on cards with their gear and exclusive
// weapon. Each pick replaces the last one for the same thing.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Breakdown } from './Breakdown';
import { BuildingPicker } from './BuildingPicker';
import { HeroCards } from './HeroCards';
import { ResearchPicker } from './ResearchPicker';
import { fetchAccounts, fetchMaterialNames, fetchTiers, loadBook } from './data';
import { levelText } from './levels';
import { type Buffs, buffsFrom, plan, totals } from './plan';
import { type Target, goalsOf, withTarget } from './targets';

type Section = 'building' | 'research' | 'heroes';
const SECTIONS: ReadonlyArray<[Section, string]> = [
  ['building', 'Buildings'],
  ['research', 'Research'],
  ['heroes', 'Heroes'],
];

function BuffInput({
  label,
  value,
  onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}{' '}
      <input
        inputMode="decimal"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step="any"
        style={{ width: '6rem' }}
        type="number"
        value={value}
      />
      %
    </label>
  );
}

export function PlannerPage() {
  const accounts = useQuery({
    queryKey: ['planner-accounts'],
    queryFn: fetchAccounts,
    staleTime: 5 * 60_000,
  });
  const tiers = useQuery({
    queryKey: ['planner-tiers'],
    queryFn: fetchTiers,
    staleTime: 60 * 60_000,
  });
  const [playerId, setPlayerId] = useState<string | null>(null);
  const account = (accounts.data ?? []).find((a) => a.playerId === playerId) ?? accounts.data?.[0];

  const [section, setSection] = useState<Section>('building');
  const [targets, setTargets] = useState<ReadonlyMap<string, Target>>(new Map());
  const [withPrereqs, setWithPrereqs] = useState(true);
  const [timedOn, setTimedOn] = useState<ReadonlySet<number>>(new Set());
  const [extra, setExtra] = useState<Buffs>({
    constructionSpeed: 0,
    researchSpeed: 0,
    costReduction: 0,
  });
  const [stockEdits, setStockEdits] = useState<Record<string, number>>({});

  const now = Date.now();
  const activeTimed = (account?.timedEffects ?? []).filter((t) => t.end > now);
  const base = account
    ? buffsFrom(
        account.effects,
        activeTimed.filter((_, i) => timedOn.has(i)),
      )
    : null;
  const buffs: Buffs | null = base
    ? {
        constructionSpeed: base.constructionSpeed + extra.constructionSpeed,
        researchSpeed: base.researchSpeed + extra.researchSpeed,
        costReduction: base.costReduction + extra.costReduction,
      }
    : null;

  const { goals, names: goalNames } = useMemo(() => goalsOf(targets.values()), [targets]);
  const levels = useMemo(() => new Map(Object.entries(account?.buildings ?? {})), [account]);
  const book = useQuery({
    queryKey: ['planner-book', account?.playerId, JSON.stringify(goals), withPrereqs],
    queryFn: () => loadBook(goals, levels, withPrereqs),
    enabled: account !== undefined && goals.length > 0,
  });
  const planned = book.data ? plan(goals, book.data, levels, withPrereqs) : null;
  const sums = planned && buffs ? totals(planned.steps, buffs) : null;
  const itemIds = (sums?.materials ?? []).filter((m) => m.type === 'item').map((m) => m.id);
  const names = useQuery({
    queryKey: ['planner-names', itemIds.join(',')],
    queryFn: () => fetchMaterialNames(itemIds),
    enabled: sums !== null,
    staleTime: 60 * 60_000,
  });

  if (accounts.isPending)
    return (
      <main>
        <p className="empty">Loading accounts…</p>
      </main>
    );
  if (accounts.isError)
    return (
      <main>
        <p className="error">Could not load accounts: {accounts.error.message}</p>
      </main>
    );
  if (!account) {
    return (
      <main>
        <h2>Material planner</h2>
        <p className="empty">
          No account to plan for. Link your character on your account page; its levels, items and
          buffs arrive with its next login the collector sees.
        </p>
      </main>
    );
  }

  const tierMap = tiers.data ?? new Map();
  const set = (target: Target) => setTargets((cur) => withTarget(cur, target));
  const remove = (key: string) =>
    setTargets((cur) => {
      const next = new Map(cur);
      next.delete(key);
      return next;
    });
  const have = (type: string, id: string) =>
    stockEdits[`${type}:${id}`] ??
    (type === 'item' ? account.items[id] : account.resources[id]) ??
    0;
  const nameOf = (type: string, id: string) =>
    (type === 'item' ? names.data?.items.get(id) : names.data?.resources.get(id)) ??
    `${type} ${id}`;
  const shown = (t: Target, level: number) =>
    t.kind === 'building' ? levelText(tierMap, t.subject, level) : String(level);

  return (
    <main>
      <h2>Material planner</h2>
      <p className="subtle">
        Costs are the game's own. Levels, stock and buffs are {account.name}'s, from the login the
        collector saw at {account.capturedAt.slice(0, 16).replace('T', ' ')} UTC. Change any buff or
        stock figure below; nothing here is saved.
      </p>

      {(accounts.data ?? []).length > 1 && (
        <div className="row">
          <label>
            Account{' '}
            <select
              onChange={(e) => {
                setPlayerId(e.target.value);
                setTargets(new Map());
                setStockEdits({});
                setTimedOn(new Set());
              }}
              value={account.playerId}
            >
              {(accounts.data ?? []).map((a) => (
                <option key={a.playerId} value={a.playerId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <section aria-labelledby="planner-buffs">
        <h3 id="planner-buffs">Buffs</h3>
        <p className="subtle">
          From the login: construction speed {base?.constructionSpeed}%, research speed{' '}
          {base?.researchSpeed}%, construction cost −{base?.costReduction}%. Add a presidential or
          emergency-project buff on top:
        </p>
        <div className="row">
          <BuffInput
            label="+ construction speed"
            onChange={(v) => setExtra({ ...extra, constructionSpeed: v })}
            value={extra.constructionSpeed}
          />
          <BuffInput
            label="+ research speed"
            onChange={(v) => setExtra({ ...extra, researchSpeed: v })}
            value={extra.researchSpeed}
          />
          <BuffInput
            label="+ cost reduction"
            onChange={(v) => setExtra({ ...extra, costReduction: v })}
            value={extra.costReduction}
          />
        </div>
        {activeTimed.length > 0 && (
          <fieldset className="row">
            <legend className="subtle">Timed buffs running at that login</legend>
            {activeTimed.map((t, i) => (
              <label key={`${t.effect}-${i}`}>
                <input
                  checked={timedOn.has(i)}
                  onChange={() =>
                    setTimedOn((cur) => {
                      const next = new Set(cur);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  type="checkbox"
                />{' '}
                effect {t.effect} +{t.value} (until{' '}
                {new Date(t.end).toISOString().slice(5, 16).replace('T', ' ')})
              </label>
            ))}
          </fieldset>
        )}
      </section>

      <section aria-labelledby="planner-goals">
        <h3 id="planner-goals">What to raise</h3>
        <div aria-label="What to raise" className="planner-tabs" role="tablist">
          {SECTIONS.map(([value, label]) => (
            <button
              aria-selected={section === value}
              key={value}
              onClick={() => setSection(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="planner-picker" role="tabpanel">
          {section === 'building' && (
            <BuildingPicker
              levels={account.buildings}
              onSet={set}
              targets={targets}
              tiers={tierMap}
            />
          )}
          {section === 'research' && (
            <ResearchPicker
              account={account}
              levels={account.science}
              onSet={set}
              targets={targets}
              tiers={tierMap}
            />
          )}
          {section === 'heroes' && <HeroCards account={account} onSet={set} targets={targets} />}
        </div>

        {targets.size > 0 && (
          <ul className="chips planner-chosen" aria-label="Chosen">
            {[...targets.entries()].map(([key, t]) => (
              <li key={key}>
                <button className="chip" onClick={() => remove(key)} title="Remove" type="button">
                  {t.name} {shown(t, t.from)} → {shown(t, t.to)}
                  {t.kind === 'hero_gear' &&
                    (t.stageTo ?? 0) > (t.stageFrom ?? 0) &&
                    ` · stage ${t.stageFrom} → ${t.stageTo}`}{' '}
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>
          <input
            checked={withPrereqs}
            onChange={(e) => setWithPrereqs(e.target.checked)}
            type="checkbox"
          />{' '}
          Include the buildings a building needs first
        </label>
      </section>

      {goals.length > 0 && (
        <section aria-labelledby="planner-result">
          <h3 id="planner-result">What it takes</h3>
          {book.isPending && <p className="empty">Adding it up…</p>}
          {book.isError && <p className="error">Could not load costs: {book.error.message}</p>}
          {planned && buffs && (
            <>
              {planned.gaps.length > 0 && (
                <p className="error">
                  Past the game's maximum or not in the catalogue:{' '}
                  {planned.gaps.map((g) => `${g.kind} ${g.subject} level ${g.level}`).join(', ')}.
                </p>
              )}
              <Breakdown
                buffs={buffs}
                goalNames={goalNames}
                have={have}
                nameOf={nameOf}
                onHave={(type, id, amount) =>
                  setStockEdits({ ...stockEdits, [`${type}:${id}`]: amount })
                }
                steps={planned.steps}
                tiers={tierMap}
              />
              <p className="note">
                Items and resources on hand come from the login; type over any figure that has
                changed since. Construction cost reduction applies to building resources, not to
                items such as Precision Parts.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
