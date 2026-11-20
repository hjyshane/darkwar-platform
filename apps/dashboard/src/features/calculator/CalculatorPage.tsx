// The calculator reference page: what a range costs, with no account open.
//
// The planner is account-bound and goal-oriented; this is its stateless
// sibling for the quick question ("what does HQ 28 to 30 cost") and the link
// that answers it in alliance chat. The ADDRESS is the state: subject, levels
// and buff percentages, nothing private. Costs are the planner's own
// (plan.ts through model.ts and data.ts), so the two cannot disagree.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { replaceHash, useHash } from '../../lib/useHash';
import { fetchMaterialNames, fetchResearchTabs, fetchTiers } from '../planner/data';
import type { Tiers } from '../planner/levels';
import { bookKey, totals } from '../planner/plan';
import { CalculatorForm } from './CalculatorForm';
import { CalculatorResult } from './CalculatorResult';
import './calculator.css';
import { fetchCalculatorSubjects, fetchExpCards, loadSteps } from './data';
import {
  type FormKind,
  SHARED_KINDS,
  buffsFor,
  goalsFor,
  hasPrerequisites,
  levelFloor,
  levelName,
  notesFor,
  planTables,
  withoutInertBuffs,
} from './model';
import { planWithPrerequisites } from './prereqs';
import { groupBySeason, isSeasonBuilding } from './seasons';
import { OUR_SERVER, groupByTree } from './trees';
import {
  type CalculatorState,
  DEFAULT_STATE,
  calculatorHash,
  clampToRange,
  parseCalculatorHash,
} from './url';

const HOUR = 60 * 60_000;
const NO_TIERS: Tiers = new Map();
const NO_LEVELS: ReadonlyMap<string, number> = new Map();

function CopyLink({ state }: { state: CalculatorState }) {
  const [said, setSaid] = useState<string | null>(null);
  const copy = async () => {
    const link = `${window.location.origin}${window.location.pathname}${calculatorHash(state)}`;
    try {
      await navigator.clipboard.writeText(link);
      setSaid('Copied');
    } catch {
      // No clipboard permission (or an insecure origin): the address bar
      // already holds the same link.
      setSaid('Copy it from the address bar');
    }
  };
  return (
    <>
      <button onClick={copy} type="button">
        Copy link
      </button>
      {said !== null && <output className="calc-copied">{said}</output>}
    </>
  );
}

export function CalculatorPage() {
  const hash = useHash();
  const state = useMemo(() => parseCalculatorHash(hash), [hash]);
  const write = (next: CalculatorState) => replaceHash(calculatorHash(withoutInertBuffs(next)));
  // "Season building" is a way of finding a building, so it lives here and
  // not in the address: a link to a season building opens under it anyway.
  const [seasonPicked, setSeasonPicked] = useState(false);
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  // The research tree is the same kind of thing: a way of finding a subject.
  const [pickedTree, setPickedTree] = useState<number | null>(null);

  const subjects = useQuery({
    queryKey: ['calculator-subjects', state.kind],
    queryFn: () => fetchCalculatorSubjects(state.kind),
    staleTime: HOUR,
  });
  const tiers = useQuery({
    queryKey: ['planner-tiers'],
    queryFn: fetchTiers,
    staleTime: HOUR,
    // A research priced with what it needs first names buildings too.
    enabled: state.kind === 'building' || state.prereqs,
  });
  const researchTabs = useQuery({
    queryKey: ['calculator-research-tabs'],
    queryFn: () => fetchResearchTabs(OUR_SERVER),
    staleTime: HOUR,
    enabled: state.kind === 'research',
  });
  const all = subjects.data ?? [];
  // A kind offered as one entry: whatever part or weapon a link names is it.
  const shared = SHARED_KINDS.has(state.kind) && all.length === 1 ? all[0] : undefined;
  const current =
    shared !== undefined && state.subject !== null
      ? shared
      : (all.find((s) => s.subject === state.subject) ?? null);

  const seasonal =
    state.kind === 'building' && (seasonPicked || (current !== null && isSeasonBuilding(current)));
  const formKind: FormKind = seasonal ? 'season' : state.kind;
  const seasons = useMemo(() => groupBySeason(subjects.data ?? []), [subjects.data]);
  const gameSeason = pickedSeason ?? current?.gameSeason ?? seasons[0]?.gameSeason ?? null;
  // Research is picked a main tree at a time, as the research screen shows it.
  // Without the tabs (not loaded, or the read failed) it is one flat list.
  const trees = useMemo(
    () =>
      state.kind === 'research' ? groupByTree(subjects.data ?? [], researchTabs.data ?? []) : [],
    [state.kind, subjects.data, researchTabs.data],
  );
  const has = (tabId: number | null | undefined) => trees.some((t) => t.tabId === tabId);
  const tree = has(pickedTree)
    ? pickedTree
    : has(current?.category)
      ? (current?.category ?? null)
      : (trees[0]?.tabId ?? null);
  const pool = seasonal
    ? (seasons.find((g) => g.gameSeason === gameSeason)?.subjects ?? [])
    : trees.length > 0
      ? (trees.find((t) => t.tabId === tree)?.subjects ?? [])
      : all.filter((s) => !isSeasonBuilding(s));

  // A kind with one subject (hero level, the vehicle) has nothing to choose.
  const only = state.subject === null && all.length === 1 ? all[0] : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the one subject arrives
  useEffect(() => {
    if (only !== undefined) {
      write({ ...state, subject: only.subject, from: levelFloor(state.kind), to: only.maxLevel });
    }
  }, [only]);

  // The range held inside the subject's track, whatever the link said.
  const range =
    current === null
      ? state
      : clampToRange(
          {
            ...state,
            subject: current.subject,
            from: Math.max(state.from, levelFloor(state.kind)),
          },
          current.maxLevel,
        );
  const goals = current === null ? [] : goalsFor(range);
  const goalKey = JSON.stringify(goals);
  const withFirst = hasPrerequisites(range.kind) && range.prereqs;
  const loaded = useQuery({
    queryKey: withFirst
      ? ['calculator-steps', goalKey, 'with-prerequisites']
      : ['calculator-steps', goalKey],
    queryFn: () => (withFirst ? loadSteps(goals, true) : loadSteps(goals)),
    enabled: goals.length > 0,
    staleTime: HOUR,
  });
  // Where the reader says a needed-first building or research really stands.
  // Theirs alone: it is not in the address, and a new range starts it over.
  const [held, setHeld] = useState<{ goal: string; levels: ReadonlyMap<string, number> }>({
    goal: '',
    levels: new Map(),
  });
  const have = held.goal === goalKey ? held.levels : NO_LEVELS;
  const floor = loaded.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: goals are named by goalKey
  const planned = useMemo(
    () =>
      floor?.book !== undefined && have.size > 0
        ? planWithPrerequisites(goals, floor.book, have)
        : floor,
    [floor, have, goalKey],
  );
  const { kind, speed, cost } = range;
  const buffs = useMemo(() => buffsFor({ kind, speed, cost }), [kind, speed, cost]);
  const tables = useMemo(
    () => (planned && floor ? planTables(planned.steps, buffs, floor.steps) : null),
    [planned, floor, buffs],
  );
  const table = tables?.all ?? null;
  const itemIds = (table?.materials ?? [])
    .filter((m) => m.type === 'item')
    .map((m) => m.id)
    .sort();
  const names = useQuery({
    queryKey: ['calculator-names', itemIds.join(',')],
    queryFn: () => fetchMaterialNames(itemIds),
    enabled: table !== null,
    staleTime: HOUR,
  });
  const cards = useQuery({
    queryKey: ['calculator-exp-cards'],
    queryFn: fetchExpCards,
    enabled: state.kind === 'chip',
    staleTime: HOUR,
  });

  const onKind = (kind: FormKind) => {
    setPickedSeason(null);
    setPickedTree(null);
    setSeasonPicked(kind === 'season');
    const next = kind === 'season' ? 'building' : kind;
    write({ ...DEFAULT_STATE, kind: next, speed: state.speed, cost: state.cost });
  };

  const gap = planned?.gaps[0];
  // A gap in something needed first is not a gap in the range itself.
  const gapIsOwn = gap !== undefined && gap.kind === range.kind && gap.subject === range.subject;
  const notes =
    planned && table ? notesFor(range, totals(planned.steps, buffs), cards.data ?? []) : [];
  if (withFirst && tables && current !== null) {
    const stands = `${current.name} ${levelName(range.kind, current.subject, range.from, tiers.data ?? NO_TIERS)}`;
    const count =
      tables.needed?.rows.filter((row) => row.amounts.size > 0 || row.seconds > 0).length ?? 0;
    const raised = have.size > 0;
    notes.unshift(
      range.from === 0
        ? count > 0
          ? `Includes ${count} needed first, each from nothing.`
          : 'Nothing is needed first.'
        : count > 0
          ? `Includes ${count} needed first, each from where ${stands} already had it. Set a level you have raised past that in the table.`
          : raised
            ? 'Nothing more is needed first at the levels you set.'
            : `Nothing more is needed first: ${stands} already asked for it all.`,
    );
  }

  return (
    <main>
      <section>
        <h2>Calculator</h2>
        <p className="calc-intro">
          What a range of upgrades costs, from the game's own tables. The selection is in the
          address, so the link can be copied into chat.
        </p>
      </section>
      <div className="calc">
        <CalculatorForm
          current={current}
          formKind={formKind}
          gameSeason={gameSeason}
          loading={subjects.isPending}
          onChange={write}
          onKind={onKind}
          onSeason={(next) => {
            setPickedSeason(next);
            write({ ...state, subject: null, from: 0, to: 0 });
          }}
          onTree={(next) => {
            setPickedTree(next);
            write({ ...state, subject: null, from: 0, to: 0 });
          }}
          pool={pool}
          tree={tree}
          trees={trees}
          seasons={seasons}
          state={range}
          tiers={tiers.data ?? NO_TIERS}
        />
        <div className="calc-result">
          {subjects.isError && (
            <p className="error">Could not load the catalogue: {subjects.error.message}</p>
          )}
          {subjects.isSuccess && state.subject !== null && current === null && (
            <p className="empty">This link names something the catalogue does not have.</p>
          )}
          {subjects.isSuccess && seasonal && seasons.length === 0 && (
            <p className="empty">The catalogue has no season buildings yet.</p>
          )}
          {subjects.isSuccess && state.subject === null && !(seasonal && seasons.length === 0) && (
            <p className="empty">Pick what to price.</p>
          )}
          {current !== null && goals.length === 0 && (
            <p className="empty">Nothing to price: {current.name} is already at that level.</p>
          )}
          {goals.length > 0 && loaded.isPending && <p className="empty loading">Loading…</p>}
          {loaded.isError && (
            <p className="error">Could not load the costs: {loaded.error.message}</p>
          )}
          {gap !== undefined && gapIsOwn && (
            <p className="error">
              The catalogue has no cost for level {gap.level}; the figures stop before it.
            </p>
          )}
          {gap !== undefined && !gapIsOwn && (
            <p className="error">
              Something this needs first has no cost in the catalogue ({gap.kind} {gap.subject},
              level {gap.level}); it is left out past there.
            </p>
          )}
          {table !== null && tables !== null && goals.length > 0 && table.rows.length > 0 && (
            <>
              <CalculatorResult
                names={names.data}
                needed={tables.needed}
                onHave={
                  floor?.book === undefined
                    ? undefined
                    : (kind, subject, level) =>
                        setHeld({
                          goal: goalKey,
                          levels: new Map(have).set(bookKey(kind, subject), level),
                        })
                }
                notes={notes}
                own={tables.own}
                state={range}
                table={table}
                tiers={tiers.data ?? NO_TIERS}
              />
              <div className="calc-actions">
                <CopyLink state={withoutInertBuffs(range)} />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
