// The material planner (item 4): pick an account, pick what to raise and to
import { PLANNER, type PlannerTab } from '../../lib/route';
import { replaceHash, useHash } from '../../lib/useHash';
// which level, and read what each costs and what it all costs after that
// account's buffs — and what is still missing from what it holds.
//
// Costs are the game's own (game_upgrade_steps, by the level reached);
// levels, stock and buffs come from the account's newest login (0205,
// 0219, 0221, 0222). Every buff and every stock figure can be overwritten
// here: a presidential buff, an emergency project, or stock that has moved
// since. Nothing typed over a login is saved.
//
// A character the collector never sees log in is entered by hand (0223):
// its levels now become inputs in every list, its buffs and stock are its
// own, and Save writes them for next time.
//
// Picking happens where the thing lives: buildings in a list, research under
// the game's research tabs, heroes on cards with their gear and exclusive
// weapon. Each pick replaces the last one for the same thing.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { AccountBar, ManualBanner } from './AccountBar';
import { Breakdown } from './Breakdown';
import { BuildingPicker } from './BuildingPicker';
import { HeroCards } from './HeroCards';
import { RecommendPanel } from './RecommendPanel';
import { ResearchPicker } from './ResearchPicker';
import { StockPanel } from './StockPanel';
import { PetPicker, VehiclePicker } from './VehiclePetPickers';
import { type Account, blankAccount, fetchAccounts, saveManual } from './accounts';
import { fetchMaterialNames, fetchTiers, loadBook } from './data';
import { levelText } from './levels';
import { type Buffs, EFFECT_IDS, buffsFrom, plan, totals } from './plan';
import { plannerStrip } from './strip';
import { type Target, goalsOf, withTarget } from './targets';

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
  // The unsaved working copy of a hand-entered account, if it has changed.
  const [draft, setDraft] = useState<Account | null>(null);
  const listed = accounts.data ?? [];
  const chosen =
    listed.find((a) => a.playerId === playerId) ??
    (draft?.playerId === playerId ? draft : undefined) ??
    listed[0];
  const account = draft && chosen && draft.playerId === chosen.playerId ? draft : chosen;
  const manual = account?.source === 'manual';
  const dirty = manual && draft !== null && draft.playerId === account?.playerId;
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: saveManual,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planner-accounts'] });
      setDraft(null);
    },
  });

  const section = PLANNER.fromHash(useHash());
  const setSection = (next: PlannerTab) => {
    replaceHash(PLANNER.hash(next));
  };
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
  // Research the account already has, so a prerequisite research it has met is
  // not planned again (0243).
  const researchLevels = useMemo(() => new Map(Object.entries(account?.science ?? {})), [account]);
  const book = useQuery({
    queryKey: [
      'planner-book',
      account?.playerId,
      JSON.stringify(goals),
      JSON.stringify(account?.buildings ?? {}),
      JSON.stringify(account?.science ?? {}),
      withPrereqs,
    ],
    queryFn: () => loadBook(goals, levels, withPrereqs, researchLevels),
    enabled: account !== undefined && goals.length > 0,
  });
  const planned = book.data ? plan(goals, book.data, levels, withPrereqs, researchLevels) : null;
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
  const switchTo = (id: string) => {
    setPlayerId(id);
    setTargets(new Map());
    setStockEdits({});
    setTimedOn(new Set());
    setDraft(null);
    save.reset();
  };
  const bar = (
    <AccountBar
      accounts={listed}
      current={account}
      onPick={switchTo}
      onStart={(who) => {
        switchTo(who.playerId);
        setDraft(blankAccount(who.playerId, who.name, who.serverId));
      }}
    />
  );
  if (!account) {
    return (
      <main>
        <h2>Material planner</h2>
        <p className="empty">
          No account to plan for yet. A character's levels, items and buffs arrive with its next
          login the collector sees — or enter them by hand:
        </p>
        {bar}
      </main>
    );
  }

  const edit = (next: Account) => setDraft(next);
  const dropTarget = (key: string) =>
    setTargets((cur) => {
      const next = new Map(cur);
      next.delete(key);
      return next;
    });
  const levelEditor = (field: 'buildings' | 'science', kind: 'building' | 'research') =>
    manual
      ? (subject: string, level: number) => {
          edit({ ...account, [field]: { ...account[field], [subject]: level } });
          dropTarget(`${kind}:${subject}`);
        }
      : undefined;

  const tierMap = tiers.data ?? new Map();
  const set = (target: Target) => setTargets((cur) => withTarget(cur, target));
  const remove = dropTarget;
  const editsOf = (type: string) =>
    Object.fromEntries(
      Object.entries(stockEdits)
        .filter(([key]) => key.startsWith(`${type}:`))
        .map(([key, amount]) => [key.slice(type.length + 1), amount]),
    );
  const have = (type: string, id: string) =>
    (manual ? undefined : stockEdits[`${type}:${id}`]) ??
    (type === 'item' ? account.items[id] : account.resources[id]) ??
    0;
  const setHave = (type: string, id: string, amount: number) => {
    if (!manual) {
      setStockEdits({ ...stockEdits, [`${type}:${id}`]: amount });
    } else if (type === 'item') {
      edit({ ...account, items: { ...account.items, [id]: amount } });
    } else {
      edit({ ...account, resources: { ...account.resources, [id]: amount } });
    }
  };
  // Stock with the reader's overwrites on top, for the upgrade ranking.
  const stockNow = {
    resources: { ...account.resources, ...(manual ? {} : editsOf('resource')) },
    items: { ...account.items, ...(manual ? {} : editsOf('item')) },
  };
  const setEffect = (id: string, value: number) =>
    edit({ ...account, effects: { ...account.effects, [id]: value } });
  const nameOf = (type: string, id: string) =>
    (type === 'item' ? names.data?.items.get(id) : names.data?.resources.get(id)) ??
    `${type} ${id}`;
  const shown = (t: Target, level: number) =>
    t.kind === 'building' ? levelText(tierMap, t.subject, level) : String(level);

  return (
    <main className="planner-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            PL
          </span>
          <div>
            <h2>Material planner</h2>
            <p className="entity-meta">
              <span>{account.name}</span>
              <span>{manual ? 'Entered by hand' : 'From the login'}</span>
              <span>Costs are the game's own</span>
            </p>
          </div>
        </header>
        {base && (
          <div className="strip">
            {plannerStrip(base, extra, targets.size).map((cell, index) => (
              <StatTile
                hero={index === 0}
                key={cell.label}
                label={cell.label}
                note={cell.note}
                value={cell.value}
              />
            ))}
          </div>
        )}
        {!manual && (
          <p className="entity-foot">
            Levels, stock and buffs are {account.name}'s, from the login the collector saw at{' '}
            {account.capturedAt.slice(0, 16).replace('T', ' ')} UTC. Change any buff or stock figure
            below; nothing here is saved.
          </p>
        )}
      </div>

      {bar}
      {manual && (
        <ManualBanner
          account={account}
          dirty={dirty}
          error={save.error ? save.error.message : null}
          onDiscard={() => {
            setDraft(null);
            if (!listed.some((a) => a.playerId === account.playerId)) setPlayerId(null);
          }}
          onSave={() => save.mutate(account)}
          saving={save.isPending}
        />
      )}

      <StockPanel
        edited={manual ? new Set() : new Set(Object.keys(stockEdits))}
        have={have}
        onHave={setHave}
      />

      <section aria-labelledby="planner-buffs">
        <h3 id="planner-buffs">Buffs</h3>
        {manual ? (
          <>
            <p className="subtle">
              The totals the game shows under Detail → Develop (research, buildings, pets and the
              rest added up):
            </p>
            <div className="row">
              <BuffInput
                label="construction speed"
                onChange={(v) => setEffect(EFFECT_IDS.constructionSpeed, v)}
                value={account.effects[EFFECT_IDS.constructionSpeed] ?? 0}
              />
              <BuffInput
                label="research speed"
                onChange={(v) => setEffect(EFFECT_IDS.researchSpeed, v)}
                value={account.effects[EFFECT_IDS.researchSpeed] ?? 0}
              />
              <BuffInput
                label="construction cost reduction"
                onChange={(v) => setEffect(EFFECT_IDS.costReduction, v)}
                value={account.effects[EFFECT_IDS.costReduction] ?? 0}
              />
            </div>
            <p className="subtle">And a presidential or emergency-project buff on top:</p>
          </>
        ) : (
          <p className="subtle">
            From the login: construction speed {base?.constructionSpeed}%, research speed{' '}
            {base?.researchSpeed}%, construction cost −{base?.costReduction}%. Add a presidential or
            emergency-project buff on top:
          </p>
        )}
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

      {buffs && <RecommendPanel account={account} buffs={buffs} onSet={set} stock={stockNow} />}

      <section aria-labelledby="planner-goals">
        <h3 id="planner-goals">What to raise</h3>
        <Tabs
          label="What to raise"
          className="planner-tabs"
          items={PLANNER.tabs.map((entry) => ({ id: entry.id, label: entry.label }))}
          value={section}
          onChange={setSection}
        />
        <div className="planner-picker" role="tabpanel">
          {section === 'building' && (
            <BuildingPicker
              levels={account.buildings}
              onCurrent={levelEditor('buildings', 'building')}
              onSet={set}
              targets={targets}
              tiers={tierMap}
            />
          )}
          {section === 'research' && (
            <ResearchPicker
              account={account}
              levels={account.science}
              onCurrent={levelEditor('science', 'research')}
              onSet={set}
              targets={targets}
              tiers={tierMap}
            />
          )}
          {section === 'vehicle' && (
            <VehiclePicker account={account} onSet={set} targets={targets} />
          )}
          {section === 'pets' && <PetPicker account={account} onSet={set} targets={targets} />}
          {section === 'heroes' && (
            <HeroCards
              account={account}
              onEdit={
                manual
                  ? (next) => {
                      // A changed level now makes old targets on heroes wrong.
                      setTargets(
                        (cur) =>
                          new Map(
                            [...cur].filter(
                              ([, t]) => !['hero', 'hero_gear', 'exclusive'].includes(t.kind),
                            ),
                          ),
                      );
                      edit(next);
                    }
                  : undefined
              }
              onSet={set}
              targets={targets}
            />
          )}
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
                steps={planned.steps}
                tiers={tierMap}
              />
              <p className="note">
                Have is the Stock list at the top; change a figure there. Construction cost
                reduction applies to building resources, not to items such as Precision Parts.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
