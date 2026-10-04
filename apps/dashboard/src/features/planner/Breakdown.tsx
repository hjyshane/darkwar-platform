// "What it takes": first what each thing costs on its own — every goal, and
// every building a goal needs first — then the total against what the
// account holds. Stock is edited in one place, the list at the top of the
// page (StockPanel); here it is only read.

import { exact, short } from './format';
import { type Tiers, levelText } from './levels';
import { type Buffs, type PlannedStep, duration, groupSteps, totals } from './plan';

interface BreakdownProps {
  steps: ReadonlyArray<PlannedStep>;
  goalNames: ReadonlyArray<string>;
  buffs: Buffs;
  tiers: Tiers;
  nameOf: (type: string, id: string) => string;
  have: (type: string, id: string) => number;
}

function Amount({ value }: { value: number }) {
  return <span title={exact(value)}>{short(value)}</span>;
}

export function Breakdown({ steps, goalNames, buffs, tiers, nameOf, have }: BreakdownProps) {
  const groups = groupSteps(steps);
  const sums = totals(steps, buffs);
  const time = (seconds: { buildSeconds: number; researchSeconds: number }) =>
    seconds.buildSeconds + seconds.researchSeconds > 0
      ? duration(seconds.buildSeconds + seconds.researchSeconds)
      : null;

  return (
    <>
      <div className="planner-cards">
        {groups.map((g) => {
          const part = totals(g.steps, buffs);
          const title = g.prerequisite ? (g.name ?? `Building ${g.subject}`) : goalNames[g.goal];
          const levels =
            g.kind === 'building'
              ? `${levelText(tiers, g.subject, g.from)} → ${levelText(tiers, g.subject, g.to)}`
              : `${g.from} → ${g.to}`;
          const took = time(part);
          return (
            <article className="planner-card" key={g.key}>
              <h4>
                {title}{' '}
                {g.prerequisite && (
                  <span className="badge" title={`Needed first by ${goalNames[g.goal]}`}>
                    needed first
                  </span>
                )}
              </h4>
              <p className="subtle">
                {levels}
                {took && ` · ${took}`}
              </p>
              <table className="compact">
                <tbody>
                  {part.materials.map((m) => (
                    <tr key={`${m.type}:${m.id}`}>
                      <td className="label">{nameOf(m.type, m.id)}</td>
                      <td className="num">
                        <Amount value={m.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          );
        })}
      </div>

      <h4>Total</h4>
      <p className="subtle">
        {steps.length} steps. Build time {duration(sums.buildSeconds)}
        {sums.researchSeconds > 0 && `, research time ${duration(sums.researchSeconds)}`} after
        buffs.
      </p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Material
              </th>
              <th className="num" scope="col">
                Needed
              </th>
              <th className="num" scope="col">
                Have
              </th>
              <th className="num" scope="col">
                Missing
              </th>
            </tr>
          </thead>
          <tbody>
            {sums.materials.map((m) => {
              const held = have(m.type, m.id);
              const missing = Math.max(0, m.amount - held);
              return (
                <tr key={`${m.type}:${m.id}`}>
                  <td className="label">{nameOf(m.type, m.id)}</td>
                  <td className="num">
                    <Amount value={m.amount} />
                  </td>
                  <td className="num">
                    <Amount value={held} />
                  </td>
                  <td className={`num${missing > 0 ? ' error' : ''}`}>
                    {missing > 0 ? <Amount value={missing} /> : '✓'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
