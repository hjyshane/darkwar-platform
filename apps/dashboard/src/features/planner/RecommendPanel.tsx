// "What should I upgrade next": the account's next building and research steps,
// ranked by the power they add (recommend.ts). It ranks; it does not choose
// for the reader. "Plan it" puts a step into the planner above like any pick.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Account } from './accounts';
import { fetchMaterialNames, fetchStepPairs } from './data';
import { type Buffs, duration } from './plan';
import { type Metric, type Recommendation, type Stock, recommend } from './recommend';
import type { Target } from './targets';

const SHOWN = 25;
const numberFormat = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const METRICS: ReadonlyArray<[Metric, string, string]> = [
  ['perHour', 'Power per hour', 'Power added divided by the time the step takes after buffs.'],
  [
    'perStock',
    'Power per stock used',
    'Power added divided by the largest share of any one stock the step would use. Steps you cannot pay for now come last.',
  ],
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
  const result = useMemo(
    () =>
      pairs.data
        ? recommend({
            pairs: pairs.data,
            buildings: new Map(Object.entries(account.buildings)),
            research: new Map(Object.entries(account.science)),
            stock,
            buffs,
            metric,
          })
        : null,
    [pairs.data, account.buildings, account.science, stock, buffs, metric],
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
        adds. Buildings and research only: heroes, gear and exclusives have no power in the game's
        data, so they are not here.
      </p>
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
