import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { exact, short } from '../planner/format';
import './calculator.css';
import {
  CURVE_STEPS,
  MAX_MONSTER_LEVEL,
  SEASON_MONSTERS,
  type SeasonTable,
  penalty,
  percentChange,
  powerFor,
  requiredFor,
  verdict,
} from './resistance';
import { parseAmount } from './wait';

const LEVELS = Array.from({ length: MAX_MONSTER_LEVEL }, (_, i) => i + 1);

const VERDICT_TEXT = {
  sufficient: 'Sufficient virus resistance',
  insufficient: 'Insufficient resistance. Keep fighting might cause huge losses.',
  defeat: 'Insufficient resistance. Certain defeat.',
} as const;

/** What a season monster does to a march whose virus resistance is short.
 *
 * Local state only, like the wait-time page: the app holds nobody's
 * resistance, so the figure is read off the Virus Lab and typed in. The
 * monster's requirement comes from the client's own ladder; it can also be
 * overridden with the figure the attack panel shows, for a monster not listed
 * or a level the ladder has wrong.
 */
export function ResistanceCalculator() {
  const [monsterId, setMonsterId] = useState(SEASON_MONSTERS[0]?.id ?? 'brute');
  const [level, setLevel] = useState(52);
  const [table, setTable] = useState<SeasonTable>('6');
  const [mine, setMine] = useState('');
  const [override, setOverride] = useState('');
  const id = useId();

  const monster = SEASON_MONSTERS.find((m) => m.id === monsterId) ?? SEASON_MONSTERS[0];
  const ladder = monster === undefined ? null : requiredFor(monster, level, table);
  const typedRequired = parseAmount(override);
  const required = typedRequired ?? ladder;
  const power = monster === undefined ? null : powerFor(monster, level);
  const own = parseAmount(mine);
  const result = own !== null && required !== null ? penalty(own, required) : null;
  const state = result === null ? null : verdict(result);

  return (
    <div className="calc">
      <form className="calc-form" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor={`${id}-monster`}>Monster</label>
          <Select id={`${id}-monster`} onChange={setMonsterId} value={monsterId}>
            {SEASON_MONSTERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.rally ? 'rally' : 'single'}
              </option>
            ))}
          </Select>
        </div>
        <div className="calc-pair">
          <div className="field">
            <label htmlFor={`${id}-level`}>Level</label>
            <Select id={`${id}-level`} onChange={(v) => setLevel(Number(v))} value={level}>
              {LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  Lv.{lv}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-table`}>Season table</label>
            <Select
              id={`${id}-table`}
              onChange={(v) => setTable(v as SeasonTable)}
              value={table}
              title="The client carries two ladders for levels 66-85; they agree below 66."
            >
              <option value="6">Table A</option>
              <option value="7">Table B</option>
            </Select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-mine`}>Your virus resistance</label>
          <input
            autoComplete="off"
            id={`${id}-mine`}
            inputMode="numeric"
            onChange={(event) => setMine(event.target.value)}
            placeholder="e.g. 8,500"
            value={mine}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-required`}>Monster&apos;s figure (optional)</label>
          <input
            autoComplete="off"
            id={`${id}-required`}
            inputMode="numeric"
            onChange={(event) => setOverride(event.target.value)}
            placeholder={ladder === null ? 'as the attack panel shows' : exact(ladder)}
            value={override}
          />
          <p className="calc-hint">
            Blank uses the ladder above. Type the figure from the attack panel to check a monster
            that is not listed.
          </p>
        </div>
      </form>

      <div aria-live="polite" className="calc-result">
        <div className="cell-grid">
          <div className="stat">
            <div className="stat-label">Required</div>
            <div className="stat-value">{required === null ? '—' : exact(required)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Shortfall</div>
            <div className="stat-value">
              {result === null ? '—' : result.deficit <= 0 ? 'none' : exact(result.deficit)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Your damage</div>
            <div className="stat-value">{result === null ? '—' : percentChange(result.self)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Monster damage</div>
            <div className="stat-value">
              {result === null ? '—' : percentChange(result.monster)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Recommended power</div>
            <div className="stat-value" title={power === null ? undefined : exact(power)}>
              {power === null ? '—' : short(power)}
            </div>
          </div>
        </div>

        <p className="note">
          {state === null && 'Type your resistance. The required figure is the client’s ladder.'}
          {state !== null && VERDICT_TEXT[state]}
        </p>

        {required !== null && (
          <div className="table-wrap">
            <table>
              <caption>At this requirement, by shortfall</caption>
              <thead>
                <tr>
                  <th scope="col">Short by</th>
                  <th scope="col">Resistance</th>
                  <th scope="col">Your damage</th>
                  <th scope="col">Monster damage</th>
                </tr>
              </thead>
              <tbody>
                {CURVE_STEPS.map((step) => {
                  const row = penalty(required - step, required);
                  return (
                    <tr key={step}>
                      <td>{exact(step)}</td>
                      <td>{exact(Math.max(0, required - step))}</td>
                      <td>{percentChange(row.self)}</td>
                      <td>{percentChange(row.monster)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="note">
          Your damage drops 0.1% a point short, to a floor of -99%. The monster gains (1 + 0.0027 ×
          short)<sup>6</sup> up to 400 short, then 1 + 0.2 × short, capped at +29,900%. From the
          client&apos;s own tables and the server&apos;s battle config, read 2026-11-20. Nothing
          typed here is sent anywhere or saved.
        </p>
      </div>
    </div>
  );
}

/** The calculator's third page. */
export function ResistanceCalculatorPage() {
  return (
    <main>
      <section>
        <h2>Virus resistance</h2>
        <p className="calc-intro">
          What a season monster does to a march whose virus resistance is short of what it wants:
          the damage you lose and the damage it gains, as the attack panel draws them.
        </p>
      </section>
      <ResistanceCalculator />
    </main>
  );
}
