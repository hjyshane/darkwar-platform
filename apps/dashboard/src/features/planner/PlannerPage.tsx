// The material planner (item 4): pick an account, add what to raise and to
// which level, and read what it costs after that account's buffs — and what
// is still missing from what it holds.
//
// Costs are the game's own (game_upgrade_steps, by the level reached);
// levels, stock and buffs come from the account's newest login (0205,
// 0219). Every buff and every stock figure can be overwritten here: a
// presidential buff, an emergency project, or resources the login does not
// list. Nothing typed here is saved.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type Account,
  type SubjectOption,
  fetchAccounts,
  fetchMaterialNames,
  fetchSubjects,
  loadBook,
} from './data';
import { type Buffs, type Goal, type Kind, buffsFrom, duration, plan, totals } from './plan';

const KINDS: ReadonlyArray<[Kind, string]> = [
  ['building', 'Building'],
  ['research', 'Research'],
  ['hero', 'Hero level'],
  ['hero_gear', 'Hero gear'],
];

/** One row the reader added. Hero gear is two tracks, levels then stages. */
interface Target {
  id: number;
  kind: Kind;
  subject: string;
  name: string;
  from: number;
  to: number;
  /** Hero gear only: current and target stage (stage-up, then awakening). */
  stageFrom?: number;
  stageTo?: number;
}

function goalsOf(targets: ReadonlyArray<Target>): Goal[] {
  const out: Goal[] = [];
  for (const t of targets) {
    if (t.kind === 'hero_gear') {
      const quality = t.subject.split(':')[2] ?? '0';
      if (t.to > t.from)
        out.push({ kind: 'hero_gear', subject: `level:q${quality}`, from: t.from, to: t.to });
      if ((t.stageTo ?? 0) > (t.stageFrom ?? 0)) {
        out.push({
          kind: 'hero_gear',
          subject: 'promote',
          from: t.stageFrom ?? 0,
          to: t.stageTo ?? 0,
        });
      }
    } else if (t.kind === 'hero') {
      out.push({ kind: 'hero', subject: 'hero', from: t.from, to: t.to });
    } else {
      out.push({ kind: t.kind, subject: t.subject, from: t.from, to: t.to });
    }
  }
  return out;
}

function n(value: number): string {
  return value.toLocaleString('en');
}

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

function TargetAdder({
  account,
  onAdd,
}: { account: Account; onAdd: (t: Omit<Target, 'id'>) => void }) {
  const [kind, setKind] = useState<Kind>('building');
  const subjects = useQuery({
    queryKey: ['planner-subjects', account.playerId, kind],
    queryFn: () => fetchSubjects(kind, account),
    staleTime: 10 * 60_000,
  });
  const [subject, setSubject] = useState('');
  const [to, setTo] = useState('');
  const [stageTo, setStageTo] = useState('');
  const chosen: SubjectOption | undefined = (subjects.data ?? []).find(
    (s) => s.subject === subject,
  );
  const gear = kind === 'hero_gear' ? account.heroGear[Number(subject.split(':')[0])] : undefined;

  const add = () => {
    if (!chosen) return;
    onAdd({
      kind,
      subject,
      name: chosen.name,
      from: chosen.current,
      to: Math.max(chosen.current, Number(to) || chosen.current),
      stageFrom: gear?.promote ?? 0,
      stageTo:
        kind === 'hero_gear' ? Math.max(gear?.promote ?? 0, Number(stageTo) || 0) : undefined,
    });
    setTo('');
    setStageTo('');
  };

  return (
    <div className="row planner-adder">
      <select
        aria-label="What to raise"
        onChange={(e) => {
          setKind(e.target.value as Kind);
          setSubject('');
        }}
        value={kind}
      >
        {KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select aria-label="Which" onChange={(e) => setSubject(e.target.value)} value={subject}>
        <option value="">{subjects.isPending ? 'Loading…' : 'Pick one…'}</option>
        {(subjects.data ?? []).map((s) => (
          <option key={s.subject} value={s.subject}>
            {s.name} — now {s.current}
          </option>
        ))}
      </select>
      <label>
        to level{' '}
        <input
          aria-label="Target level"
          min={0}
          onChange={(e) => setTo(e.target.value)}
          style={{ width: '5rem' }}
          type="number"
          value={to}
        />
      </label>
      {kind === 'hero_gear' && (
        <label title="After level 100: stages 1-10 are stage-ups, 11-36 awakening">
          stage{' '}
          <input
            aria-label="Target stage"
            min={0}
            onChange={(e) => setStageTo(e.target.value)}
            placeholder={String(gear?.promote ?? 0)}
            style={{ width: '4rem' }}
            type="number"
            value={stageTo}
          />
        </label>
      )}
      <button disabled={!chosen} onClick={add} type="button">
        Add
      </button>
    </div>
  );
}

export function PlannerPage() {
  const accounts = useQuery({
    queryKey: ['planner-accounts'],
    queryFn: fetchAccounts,
    staleTime: 5 * 60_000,
  });
  const [playerId, setPlayerId] = useState<string | null>(null);
  const account = (accounts.data ?? []).find((a) => a.playerId === playerId) ?? accounts.data?.[0];

  const [targets, setTargets] = useState<Target[]>([]);
  const [nextId, setNextId] = useState(1);
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

  const goals = useMemo(() => goalsOf(targets), [targets]);
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

  const have = (type: string, id: string) =>
    stockEdits[`${type}:${id}`] ?? (type === 'item' ? (account.items[id] ?? 0) : 0);
  const nameOf = (type: string, id: string) =>
    (type === 'item' ? names.data?.items.get(id) : names.data?.resources.get(id)) ??
    `${type} ${id}`;

  return (
    <main>
      <h2>Material planner</h2>
      <p className="subtle">
        Costs are the game's own. Levels, items and buffs are {account.name}'s, from the login the
        collector saw at {account.capturedAt.slice(0, 16).replace('T', ' ')} UTC. Change any buff or
        stock figure below; nothing here is saved.
      </p>

      <div className="row">
        {(accounts.data ?? []).length > 1 && (
          <label>
            Account{' '}
            <select
              onChange={(e) => {
                setPlayerId(e.target.value);
                setTargets([]);
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
        )}
      </div>

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
        <TargetAdder
          account={account}
          onAdd={(t) => {
            setTargets([...targets, { ...t, id: nextId }]);
            setNextId(nextId + 1);
          }}
        />
        <label>
          <input
            checked={withPrereqs}
            onChange={(e) => setWithPrereqs(e.target.checked)}
            type="checkbox"
          />{' '}
          Include the buildings a building needs first
        </label>
        {targets.length > 0 && (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="label" scope="col">
                    Target
                  </th>
                  <th className="num" scope="col">
                    From
                  </th>
                  <th className="num" scope="col">
                    To
                  </th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td className="label">{t.name}</td>
                    <td className="num">
                      {t.from}
                      {t.kind === 'hero_gear' && ` · stage ${t.stageFrom}`}
                    </td>
                    <td className="num">
                      {t.to}
                      {t.kind === 'hero_gear' && ` · stage ${t.stageTo}`}
                    </td>
                    <td>
                      <button
                        onClick={() => setTargets(targets.filter((x) => x.id !== t.id))}
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {goals.length > 0 && (
        <section aria-labelledby="planner-result">
          <h3 id="planner-result">What it takes</h3>
          {book.isPending && <p className="empty">Adding it up…</p>}
          {book.isError && <p className="error">Could not load costs: {book.error.message}</p>}
          {planned && sums && (
            <>
              <p className="subtle">
                {planned.steps.length} steps
                {planned.steps.some((s) => s.prerequisite) &&
                  `, ${planned.steps.filter((s) => s.prerequisite).length} of them buildings needed first`}
                . Build time {duration(sums.buildSeconds)}
                {sums.researchSeconds > 0 && `, research time ${duration(sums.researchSeconds)}`}{' '}
                after buffs.
              </p>
              {planned.gaps.length > 0 && (
                <p className="error">
                  Past the game's maximum or not in the catalogue:{' '}
                  {planned.gaps.map((g) => `${g.kind} ${g.subject} level ${g.level}`).join(', ')}.
                </p>
              )}
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
                      const short = Math.max(0, m.amount - held);
                      return (
                        <tr key={`${m.type}:${m.id}`}>
                          <td className="label">{nameOf(m.type, m.id)}</td>
                          <td className="num">{n(m.amount)}</td>
                          <td className="num">
                            <input
                              aria-label={`Have ${nameOf(m.type, m.id)}`}
                              min={0}
                              onChange={(e) =>
                                setStockEdits({
                                  ...stockEdits,
                                  [`${m.type}:${m.id}`]: Number(e.target.value) || 0,
                                })
                              }
                              style={{ width: '9rem' }}
                              type="number"
                              value={held}
                            />
                          </td>
                          <td className={`num${short > 0 ? ' error' : ''}`}>
                            {short > 0 ? n(short) : '✓'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="note">
                Items on hand come from the login; resources (wood, iron, electricity, food) are not
                in it, so type what you hold. Construction cost reduction applies to building
                resources, not to items such as Precision Parts.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
