// The calculator reference page: what a range costs, with no account open.
//
// The planner is account-bound and goal-oriented; this is its stateless
// sibling for the quick question ("what does HQ 28 to 30 cost") and the link
// that answers it in alliance chat. The ADDRESS is the state: subject, levels
// and buff percentages, nothing private. Costs are the planner's own
// (plan.ts through model.ts and data.ts), so the two cannot disagree.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useIsCommunity } from '../../lib/communityAccess';
import { replaceHash, useHash } from '../../lib/useHash';
import { fetchAccounts } from '../planner/accounts';
import { fetchMaterialNames, fetchTiers } from '../planner/data';
import type { Tiers } from '../planner/levels';
import { totals } from '../planner/plan';
import { CalculatorForm } from './CalculatorForm';
import { CalculatorResult } from './CalculatorResult';
import './calculator.css';
import { fetchCalculatorSubjects, fetchExpCards, loadSteps } from './data';
import { canHandOff, plannerHandoffHash } from './handoff';
import {
  type FormKind,
  buffsFor,
  goalsFor,
  levelFloor,
  notesFor,
  stepTable,
  withoutInertBuffs,
} from './model';
import { groupBySeason, isSeasonBuilding } from './seasons';
import {
  type CalculatorState,
  DEFAULT_STATE,
  calculatorHash,
  clampToRange,
  parseCalculatorHash,
} from './url';

const HOUR = 60 * 60_000;
const NO_TIERS: Tiers = new Map();

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
  const isCommunity = useIsCommunity();

  const subjects = useQuery({
    queryKey: ['calculator-subjects', state.kind],
    queryFn: () => fetchCalculatorSubjects(state.kind),
    staleTime: HOUR,
  });
  const tiers = useQuery({
    queryKey: ['planner-tiers'],
    queryFn: fetchTiers,
    staleTime: HOUR,
    enabled: state.kind === 'building',
  });
  const all = subjects.data ?? [];
  const current = all.find((s) => s.subject === state.subject) ?? null;

  const seasonal =
    state.kind === 'building' && (seasonPicked || (current !== null && isSeasonBuilding(current)));
  const formKind: FormKind = seasonal ? 'season' : state.kind;
  const seasons = useMemo(() => groupBySeason(subjects.data ?? []), [subjects.data]);
  const gameSeason = pickedSeason ?? current?.gameSeason ?? seasons[0]?.gameSeason ?? null;
  const pool = !seasonal
    ? all.filter((s) => !isSeasonBuilding(s))
    : (seasons.find((g) => g.gameSeason === gameSeason)?.subjects ?? []);

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
          { ...state, from: Math.max(state.from, levelFloor(state.kind)) },
          current.maxLevel,
        );
  const goals = current === null ? [] : goalsFor(range);
  const goalKey = JSON.stringify(goals);
  const loaded = useQuery({
    queryKey: ['calculator-steps', goalKey],
    queryFn: () => loadSteps(goals),
    enabled: goals.length > 0,
    staleTime: HOUR,
  });
  const { speed, cost } = range;
  const buffs = useMemo(() => buffsFor({ speed, cost }), [speed, cost]);
  const table = useMemo(
    () => (loaded.data ? stepTable(loaded.data.steps, buffs) : null),
    [loaded.data, buffs],
  );
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
  // "Load into my plan" is for a viewer who has somewhere to load it: an
  // account the planner lists, or the scratch account a community reader plans on.
  const accounts = useQuery({
    queryKey: ['planner-accounts'],
    queryFn: fetchAccounts,
    staleTime: 5 * 60_000,
    enabled: canHandOff(state.kind),
  });
  const mayHandOff =
    canHandOff(state.kind) && (isCommunity || (accounts.data ?? []).length > 0) && current !== null;

  const onKind = (kind: FormKind) => {
    setPickedSeason(null);
    setSeasonPicked(kind === 'season');
    const next = kind === 'season' ? 'building' : kind;
    write({ ...DEFAULT_STATE, kind: next, speed: state.speed, cost: state.cost });
  };

  const gap = loaded.data?.gaps[0];
  const notes =
    loaded.data && table ? notesFor(range, totals(loaded.data.steps, buffs), cards.data ?? []) : [];

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
          pool={pool}
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
          {gap !== undefined && (
            <p className="error">
              The catalogue has no cost for level {gap.level}; the figures stop before it.
            </p>
          )}
          {table !== null && goals.length > 0 && table.rows.length > 0 && (
            <>
              <CalculatorResult
                names={names.data}
                notes={notes}
                state={range}
                table={table}
                tiers={tiers.data ?? NO_TIERS}
              />
              <div className="calc-actions">
                <CopyLink state={withoutInertBuffs(range)} />
                {mayHandOff && state.subject !== null && (
                  <button
                    className="primary"
                    onClick={() => {
                      window.location.hash = plannerHandoffHash({
                        kind: range.kind as Parameters<typeof plannerHandoffHash>[0]['kind'],
                        subject: state.subject as string,
                        to: range.to,
                      });
                    }}
                    title="Adds this as a target in the planner, from your account's own level. Nothing is saved until the planner saves."
                    type="button"
                  >
                    Load into my plan
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
