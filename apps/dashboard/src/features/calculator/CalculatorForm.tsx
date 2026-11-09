// The calculator's form: what to price, between which levels, with which
// buffs. It owns no state of its own beyond the search box; every choice is
// handed up as the next address state.

import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import type { Subject } from '../planner/data';
import type { Tiers } from '../planner/levels';
import { type FormKind, KIND_OPTIONS, buffFields, levelFloor, levelName } from './model';
import { filterSubjects } from './search';
import type { SeasonGroup } from './seasons';
import type { CalculatorState } from './url';

export interface CalculatorFormProps {
  state: CalculatorState;
  formKind: FormKind;
  /** The subjects offered under the chosen kind (and season). */
  pool: ReadonlyArray<Subject>;
  /** The subject the address names, when the catalogue has it. */
  current: Subject | null;
  /** Season groups, when the form kind is `season`. */
  seasons: ReadonlyArray<SeasonGroup>;
  gameSeason: number | null;
  tiers: Tiers;
  loading: boolean;
  onKind: (kind: FormKind) => void;
  onSeason: (gameSeason: number) => void;
  onChange: (next: CalculatorState) => void;
}

function levels(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

function percent(value: string, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}

export function CalculatorForm({
  state,
  formKind,
  pool,
  current,
  seasons,
  gameSeason,
  tiers,
  loading,
  onKind,
  onSeason,
  onChange,
}: CalculatorFormProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const fields = buffFields(state.kind);
  const floor = levelFloor(state.kind);
  const found = filterSubjects(pool, query);
  // The chosen subject stays listed while the search hides it, so the
  // dropdown never shows a value it does not contain.
  const options =
    current !== null && !found.some((s) => s.subject === current.subject)
      ? [current, ...found]
      : found;
  const name = (level: number) => levelName(state.kind, state.subject ?? '', level, tiers);

  const pick = (subjectId: string) => {
    const next = pool.find((s) => s.subject === subjectId);
    onChange(
      next === undefined
        ? { ...state, subject: null, from: 0, to: 0 }
        : { ...state, subject: next.subject, from: floor, to: next.maxLevel },
    );
  };

  return (
    <form className="calc-form" onSubmit={(event) => event.preventDefault()}>
      <div className="field">
        <label htmlFor={`${id}-kind`}>Kind</label>
        <Select id={`${id}-kind`} onChange={(v) => onKind(v as FormKind)} value={formKind}>
          {KIND_OPTIONS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label}
            </option>
          ))}
        </Select>
      </div>

      {formKind === 'season' && seasons.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-season`}>Season</label>
          <Select
            id={`${id}-season`}
            onChange={(v) => onSeason(Number(v))}
            value={gameSeason ?? seasons[0]?.gameSeason ?? ''}
          >
            {seasons.map((season) => (
              <option key={season.gameSeason} value={season.gameSeason}>
                {season.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {pool.length > 8 && (
        <div className="field">
          <label htmlFor={`${id}-find`}>Find</label>
          <input
            autoComplete="off"
            id={`${id}-find`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, English or Korean"
            type="search"
            value={query}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-subject`}>Subject</label>
        <Select
          disabled={loading}
          id={`${id}-subject`}
          onChange={pick}
          value={current?.subject ?? ''}
        >
          <option value="">{loading ? 'Loading…' : `Choose (${found.length})`}</option>
          {options.map((s) => (
            <option key={s.subject} value={s.subject}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {current !== null && (
        <div className="calc-pair">
          <div className="field">
            <label htmlFor={`${id}-from`}>From</label>
            <Select
              id={`${id}-from`}
              onChange={(v) => {
                const from = Number(v);
                onChange({ ...state, from, to: Math.max(state.to, from + 1) });
              }}
              value={state.from}
            >
              {levels(floor, current.maxLevel - 1).map((level) => (
                <option key={level} value={level}>
                  {name(level)}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-to`}>To</label>
            <Select
              id={`${id}-to`}
              onChange={(v) => onChange({ ...state, to: Number(v) })}
              value={state.to}
            >
              {levels(state.from + 1, current.maxLevel).map((level) => (
                <option key={level} value={level}>
                  {name(level)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {(fields.speed || fields.cost) && (
        <>
          <hr className="calc-rule" />
          <div className="calc-pair">
            {fields.speed && (
              <div className="field">
                <label htmlFor={`${id}-speed`}>Speed bonus %</label>
                <input
                  id={`${id}-speed`}
                  inputMode="decimal"
                  min={0}
                  onChange={(event) =>
                    onChange({ ...state, speed: percent(event.target.value, 10_000) })
                  }
                  step="any"
                  type="number"
                  value={state.speed}
                />
              </div>
            )}
            {fields.cost && (
              <div className="field">
                <label htmlFor={`${id}-cost`}>Cost reduction %</label>
                <input
                  id={`${id}-cost`}
                  inputMode="decimal"
                  max={100}
                  min={0}
                  onChange={(event) =>
                    onChange({ ...state, cost: percent(event.target.value, 100) })
                  }
                  step="any"
                  type="number"
                  value={state.cost}
                />
              </div>
            )}
          </div>
        </>
      )}
    </form>
  );
}
