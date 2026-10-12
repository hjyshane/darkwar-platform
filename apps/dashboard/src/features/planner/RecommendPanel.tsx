// "What should I upgrade next": the account's next building and research steps,
// ranked by the power they add (recommend.ts). It ranks; it does not choose
// for the reader. "Plan it" puts a step into the planner above like any pick.

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { compactNumber } from '../../lib/compactNumber';
import { useSeasons } from '../../lib/seasons';
import type { Account } from './accounts';
import { type StepCategory, categoryOf, isNotUpgradable } from './categories';
import {
  fetchCatalogSubjects,
  fetchMaterialNames,
  fetchPlannerBuildingIds,
  fetchStepPairs,
} from './data';
import { useHidden } from './hidden';
import { type Buffs, duration } from './plan';
import { type Metric, type Recommendation, type Stock, recommend } from './recommend';
import type { Target } from './targets';

const SHOWN = 25;
const numberFormat = new Intl.NumberFormat('en');
const compact = compactNumber(1);

const METRICS: ReadonlyArray<[Metric, string, string]> = [
  ['perHour', 'Power per hour', 'Power added divided by the time the step takes after buffs.'],
  [
    'perStock',
    'Power per stock used',
    'Power added divided by the largest share of any one stock the step would use. Steps you cannot pay for now come last.',
  ],
];

// Season buildings are not offered (user, 2026-10-12): What to raise does not
// list them, and this list follows it.
const CATEGORIES: ReadonlyArray<[StepCategory, string]> = [
  ['building', 'Buildings'],
  ['research', 'Research'],
];

export function RecommendPanel({
  account,
  buffs,
  stock,
  onSet,
}: {
  account: Account;
  buffs: Buffs;
  stock: Stock;
  onSet: (target: Target) => void;
}) {
  const [metric, setMetric] = useState<Metric>('perHour');
  const [category, setCategory] = useState<StepCategory>('building');
  const seasons = useSeasons();
  // The buildings What to raise lists, and only those: a login's own, or the
  // ones accounts have when levels are typed in (0286); never one the reader
  // hid there. 'all' when nobody has logged in and there is nothing to go on.
  const manual = account.source === 'manual';
  const known = useQuery({
    queryKey: ['planner-building-ids'],
    enabled: manual,
    staleTime: 60 * 60_000,
    queryFn: fetchPlannerBuildingIds,
  });
  const [hiddenBuildings] = useHidden('planner-hidden-buildings');
  const listed = useMemo((): ReadonlySet<string> | 'all' | null => {
    if (!manual) return new Set(Object.keys(account.buildings));
    if (!known.isSuccess && !known.isError) return null;
    const ids = known.data ?? [];
    return ids.length === 0 ? 'all' : new Set([...ids, ...Object.keys(account.buildings)]);
  }, [manual, known.isSuccess, known.isError, known.data, account.buildings]);
  const offered = useCallback(
    (p: { next: { kind: string; subject_id: string } }) =>
      p.next.kind !== 'building' ||
      (listed !== null &&
        (listed === 'all' || listed.has(p.next.subject_id)) &&
        !hiddenBuildings.has(p.next.subject_id)),
    [listed, hiddenBuildings],
  );
  const catalogue = useQuery({
    queryKey: ['planner-catalog', 'building', '*'],
    queryFn: () => fetchCatalogSubjects('building', {}),
    staleTime: 60 * 60_000,
  });
  const pairs = useQuery({
    queryKey: [
      'planner-pairs',
      account.playerId,
      JSON.stringify(account.buildings),
      JSON.stringify(account.science),
    ],
    queryFn: () => fetchStepPairs(account.buildings, account.science),
    staleTime: 5 * 60_000,
  });
  // Season buildings are whatever any season lists; a building with a highest
  // level of 0 or 1 (Road, Arena...) cannot be upgraded and is not offered.
  const seasonIds = useMemo(
    () => new Set((seasons.data ?? []).flatMap((s) => s.buildings.map((b) => String(b.id)))),
    [seasons.data],
  );
  const maxLevels = useMemo(
    () => new Map((catalogue.data ?? []).map((s) => [s.subject, s.maxLevel] as const)),
    [catalogue.data],
  );
  const inCategory = useMemo(
    () =>
      (pairs.data ?? []).filter(
        (p) =>
          categoryOf(p.next, seasonIds) === category &&
          offered(p) &&
          !(p.next.kind === 'building' && isNotUpgradable(p.next, maxLevels)),
      ),
    [pairs.data, seasonIds, maxLevels, category, offered],
  );
  const counts = useMemo(() => {
    const out: Record<StepCategory, number> = { building: 0, research: 0, season: 0 };
    for (const p of pairs.data ?? []) {
      if (p.next.kind === 'building' && isNotUpgradable(p.next, maxLevels)) continue;
      if (!offered(p)) continue;
      out[categoryOf(p.next, seasonIds)] += 1;
    }
    return out;
  }, [pairs.data, seasonIds, maxLevels, offered]);
  const result = useMemo(
    () =>
      pairs.data
        ? recommend({
            pairs: inCategory,
            buildings: new Map(Object.entries(account.buildings)),
            research: new Map(Object.entries(account.science)),
            stock,
            buffs,
            metric,
          })
        : null,
    [pairs.data, inCategory, account.buildings, account.science, stock, buffs, metric],
  );
  const top = result?.ranked.slice(0, SHOWN) ?? [];
  const itemIds = [
    ...new Set(top.flatMap((r) => r.costs.filter((c) => c.type === 'item').map((c) => c.id))),
  ];
  const names = useQuery({
    queryKey: ['planner-names', itemIds.join(',')],
    queryFn: () => fetchMaterialNames(itemIds),
    enabled: itemIds.length > 0,
    staleTime: 60 * 60_000,
  });
  const costName = (type: string, id: string) =>
    (type === 'item' ? names.data?.items.get(id) : names.data?.resources.get(id)) ??
    `${type} ${id}`;

  return (
    <section aria-labelledby="planner-recommend">
      <h3 id="planner-recommend">Next upgrades</h3>
      <p className="subtle">
        The next level of every building and research {account.name} could advance, by the power it
        adds, grouped into buildings and research. Heroes, gear and exclusives have no power in the
        game's data, so they are not here; buildings that cannot be upgraded, and any that What to
        raise does not list, are left out.
      </p>
      <div className="row">
        {CATEGORIES.map(([value, label]) => (
          <button
            className={category === value ? 'active' : ''}
            key={value}
            onClick={() => setCategory(value)}
            type="button"
          >
            {label} ({counts[value]})
          </button>
        ))}
      </div>
      <div className="row">
        {METRICS.map(([value, label, hint]) => (
          <button
            className={metric === value ? 'active' : ''}
            key={value}
            onClick={() => setMetric(value)}
            title={hint}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {pairs.isPending && <p className="empty">Working it out…</p>}
      {pairs.isError && <p className="error">Could not load upgrades: {pairs.error.message}</p>}
      {result && top.length === 0 && (
        <p className="empty">
          Nothing here adds power, or every candidate is waiting on something.
        </p>
      )}
      {top.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Upgrade</th>
              <th>Adds</th>
              <th>Time</th>
              <th>Costs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <Row
                costName={costName}
                key={`${r.step.kind}:${r.step.subject_id}`}
                onSet={onSet}
                rec={r}
              />
            ))}
          </tbody>
        </table>
      )}
      {result && (
        <p className="note">
          {result.ranked.length > SHOWN && `Top ${SHOWN} of ${result.ranked.length}. `}
          {result.noPower.length > 0 &&
            `${result.noPower.length} more add no power (decorations, utility research) and are left out. `}
          {result.unknown.length > 0 &&
            `${result.unknown.length} have no power figure in the catalogue, so their gain is unknown and they are left out. `}
          {result.blocked.length > 0 &&
            `${result.blocked.length} wait on a prerequisite you have not reached.`}
        </p>
      )}
      {result && result.blocked.length > 0 && (
        <details>
          <summary>Waiting on a prerequisite</summary>
          <ul>
            {result.blocked.slice(0, 30).map((c) => (
              <li key={`${c.step.kind}:${c.step.subject_id}`}>
                {c.step.name ?? c.step.subject_id} {c.step.level - 1} → {c.step.level} needs{' '}
                {c.blockedBy
                  .map(
                    (b) =>
                      `${b.kind === 'research' ? 'research' : 'building'} ${b.subject} level ${b.level}`,
                  )
                  .join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Row({
  rec,
  costName,
  onSet,
}: {
  rec: Recommendation;
  costName: (type: string, id: string) => string;
  onSet: (target: Target) => void;
}) {
  const { step } = rec;
  const name = step.name ?? step.subject_id;
  return (
    <tr className={rec.affordable ? undefined : 'subtle'}>
      <td>
        {name} {step.level - 1} → {step.level}
      </td>
      <td title={numberFormat.format(rec.gain)}>+{compact.format(rec.gain)}</td>
      <td>{rec.hours === null ? 'instant' : duration(Math.round(rec.hours * 3600))}</td>
      <td>
        {rec.costs.length === 0
          ? 'nothing'
          : rec.costs
              .slice(0, 3)
              .map((c) => `${compact.format(c.amount)} ${costName(c.type, c.id)}`)
              .join(', ')}
        {rec.affordable ? '' : ' · not enough stock'}
      </td>
      <td>
        <button
          onClick={() =>
            onSet({
              kind: step.kind,
              subject: step.subject_id,
              name,
              from: step.level - 1,
              to: step.level,
            })
          }
          type="button"
        >
          Plan it
        </button>
      </td>
    </tr>
  );
}
