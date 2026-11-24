import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { formatAge } from '../../lib/freshness';
import { rich, useT } from '../../lib/i18n';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { useActiveAlliance } from '../../lib/useMyAlliances';
import { useSession } from '../../lib/useSession';
import { PlanDeletedError, StaleSaveError, draftStatus } from '../hive/hiveSafety';
import { BattlefieldSvg, OrientationToggle } from './BattlefieldMap';
import {
  type Assignment,
  type Draft,
  PLAN_OBJECTIVES,
  type Starter,
  byObjective,
  countsOf,
  draftFrom,
  handout,
  isUnsaved,
  objectiveLabel,
  payloadOf,
} from './bgbPlan';
import {
  type BgbPlan,
  type PlanDetail,
  createPlan,
  deletePlan,
  makeLive,
  restorePlan,
  savePlan,
  usePlanDetail,
  usePlans,
  useStarters,
} from './bgbPlanData';

type Team = 1 | 2;

/** Who takes which objective in the next Black Gold battle (0331).
 *
 * Officers (hive.plan) draw several drafts per team and make one live; every
 * member sees the live plan, their own objective first. Only starters are
 * placed: substitutes enter after the battle starts (owner, 2026-11-18). */
export function BgbPlanPanel() {
  const t = useT();
  const [team, setTeam] = useState<Team>(1);
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayPlan = isAllowed(permissions?.grants, session?.role, 'hive.plan');

  return (
    <section aria-labelledby="bgb-plan-heading" className="panel bgb-plan">
      <h3 id="bgb-plan-heading">{t('Battle plan')}</h3>
      <Tabs
        label={t('Team')}
        items={[
          { id: 1, label: t('Team A') },
          { id: 2, label: t('Team B') },
        ]}
        value={team}
        onChange={(next) => setTeam(next as Team)}
      />
      {mayPlan ? (
        <OfficerView key={team} team={team} />
      ) : (
        <MemberView key={team} playerId={session?.playerId ?? null} team={team} />
      )}
    </section>
  );
}

function MemberView({ team, playerId }: { team: Team; playerId: string | null }) {
  const t = useT();
  const plans = usePlans(team);
  const live = (plans.data ?? []).find((p) => p.isLive && p.deletedAt === null) ?? null;
  const detail = usePlanDetail(live?.planId ?? null);
  const [flipped, setFlipped] = useState(false);

  if (plans.isPending) return <p className="empty loading">{t('Loading…')}</p>;
  if (plans.error)
    return (
      <p className="error">{t('Could not load plans: {error}', { error: plans.error.message })}</p>
    );
  if (live === null) {
    return (
      <p className="empty">
        {t(
          'No plan is live for this team yet. Officers (R4/R5) draw one before the battle; your objective will appear here when they do.',
        )}
      </p>
    );
  }
  const people = detail.data?.assignments ?? [];
  const mine = playerId === null ? undefined : people.find((a) => a.playerId === playerId);
  return (
    <>
      <p className="hive-mine">
        <span>{live.name}</span>
        {mine ? (
          <strong>
            {t('Your objective: {objective}', {
              objective: objectiveLabel(mine.objectiveKey, t),
            })}
            {mine.role !== '' && ` — ${mine.role}`}
          </strong>
        ) : (
          <span>
            {playerId === null
              ? t('Link your account to a character to see your objective.')
              : t('You have no objective in this plan.')}
          </span>
        )}
      </p>
      <PlanPicture
        assignments={people}
        flipped={flipped}
        highlight={mine?.objectiveKey ?? null}
        onFlip={setFlipped}
      />
    </>
  );
}

function PlanPicture({
  assignments,
  flipped,
  onFlip,
  highlight,
}: {
  assignments: readonly Assignment[];
  flipped: boolean;
  onFlip: (flipped: boolean) => void;
  highlight: string | null;
}) {
  const t = useT();
  return (
    <div className="bf-layout">
      <div>
        <OrientationToggle flipped={flipped} onChange={onFlip} />
        <BattlefieldSvg counts={countsOf(assignments)} flipped={flipped} highlight={highlight} />
      </div>
      <ul className="bgb-plan-list">
        {byObjective(assignments, t).map((group) => (
          <li key={group.objectiveKey}>
            <strong>{group.label}</strong>:{' '}
            {group.people
              .map((p) =>
                p.role === '' ? (p.playerName ?? '?') : `${p.playerName ?? '?'} (${p.role})`,
              )
              .join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OfficerView({ team }: { team: Team }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { active } = useActiveAlliance();
  const plans = usePlans(team);
  const starters = useStarters(active?.alliance_id ?? null, team);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');

  const live = (plans.data ?? []).filter((p) => p.deletedAt === null);
  const deleted = (plans.data ?? []).filter((p) => p.deletedAt !== null);
  const plan =
    live.find((p) => p.planId === chosen) ?? live.find((p) => p.isLive) ?? live[0] ?? null;

  const create = useMutation({
    mutationFn: () =>
      createPlan(
        team,
        name.trim() === ''
          ? t('Team {team} plan {number}', {
              team: team === 1 ? 'A' : 'B',
              number: live.length + 1,
            })
          : name.trim(),
      ),
    onSuccess: (planId) => {
      setName('');
      setChosen(planId);
      return queryClient.invalidateQueries({ queryKey: ['bgb'] });
    },
  });
  const restore = useMutation({
    mutationFn: restorePlan,
    onSuccess: (_, planId) => {
      setChosen(planId);
      return queryClient.invalidateQueries({ queryKey: ['bgb'] });
    },
  });

  if (plans.isPending) return <p className="empty loading">{t('Loading…')}</p>;
  if (plans.error)
    return (
      <p className="error">{t('Could not load plans: {error}', { error: plans.error.message })}</p>
    );

  return (
    <>
      <div className="hive-picker">
        {live.length > 0 && plan !== null && (
          <label>
            <span>{t('Plan')}</span>
            <select onChange={(event) => setChosen(event.target.value)} value={plan.planId}>
              {live.map((p) => (
                <option key={p.planId} value={p.planId}>
                  {p.name}
                  {p.isLive ? ` · ${t('live')}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t('New plan')}</span>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder={t('Name (optional)')}
            value={name}
          />
        </label>
        <button disabled={create.isPending} onClick={() => create.mutate()} type="button">
          {create.isPending ? t('Creating…') : t('Start a new plan')}
        </button>
      </div>
      {create.error && <p className="error">{create.error.message}</p>}

      {plan === null ? (
        <p className="empty">{t('No plan for this team yet. Start one above.')}</p>
      ) : starters.isPending ? (
        <p className="empty loading">{t('Loading starters…')}</p>
      ) : starters.error ? (
        <p className="error">
          {t('Could not load the signup list: {error}', { error: starters.error.message })}
        </p>
      ) : (
        <PlanEditor
          key={plan.planId}
          onDeleted={() => setChosen(null)}
          plan={plan}
          readAt={starters.data?.readAt ?? null}
          starters={starters.data?.starters ?? []}
        />
      )}

      {deleted.length > 0 && (
        <details className="hive-new">
          <summary>{t('Recently deleted ({count})', { count: deleted.length })}</summary>
          <ul>
            {deleted.map((p) => (
              <li key={p.planId}>
                {p.name}{' '}
                <button
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(p.planId)}
                  type="button"
                >
                  {t('Restore')}
                </button>
              </li>
            ))}
          </ul>
          {restore.error && <p className="error">{restore.error.message}</p>}
        </details>
      )}
    </>
  );
}

function PlanEditor({
  plan,
  starters,
  readAt,
  onDeleted,
}: {
  plan: BgbPlan;
  starters: readonly Starter[];
  readAt: string | null;
  onDeleted: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const detail = usePlanDetail(plan.planId);
  // The version the draft is built from. Set from the first read, then moved
  // only by this officer's own save or by choosing to load a newer version —
  // never by a refetch, which is what lets a newer version be noticed.
  const [base, setBase] = useState<PlanDetail | null>(null);
  if (base === null && detail.data) {
    setBase(detail.data);
  }
  if (detail.isPending || base === null) return <p className="empty loading">{t('Loading…')}</p>;
  if (detail.error)
    return (
      <p className="error">
        {t('Could not load the plan: {error}', { error: detail.error.message })}
      </p>
    );
  if (detail.data === null) return <p className="empty">{t('This plan is no longer there.')}</p>;
  const latest = detail.data;
  return (
    <DraftEditor
      base={base}
      key={base.version}
      latestVersion={latest?.version ?? base.version}
      onAdopt={() => {
        // Read the cache at the moment of adopting, not the render's copy:
        // after a refetch the render's copy is the old one.
        const fresh = queryClient.getQueryData<PlanDetail | null>(['bgb', 'detail', plan.planId]);
        if (fresh) setBase(fresh);
      }}
      onDeleted={onDeleted}
      onSaved={(version, assignments) => setBase({ version, assignments })}
      plan={plan}
      readAt={readAt}
      starters={starters}
    />
  );
}

function DraftEditor({
  plan,
  starters,
  readAt,
  base,
  latestVersion,
  onAdopt,
  onSaved,
  onDeleted,
}: {
  plan: BgbPlan;
  starters: readonly Starter[];
  readAt: string | null;
  base: PlanDetail;
  latestVersion: number;
  onAdopt: () => void;
  onSaved: (version: number, assignments: Assignment[]) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const initial = draftFrom(base.assignments, starters, t);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [flipped, setFlipped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const unsaved = isUnsaved(draft, initial.draft) || initial.dropped.length > 0;

  const status = draftStatus({ unsaved, baseVersion: base.version, boardVersion: latestVersion });
  // Somebody else saved and nothing here is unsaved: take theirs quietly.
  useEffect(() => {
    if (status === 'behind') onAdopt();
  }, [status, onAdopt]);

  const save = useMutation({
    mutationFn: () =>
      savePlan({
        planId: plan.planId,
        version: base.version,
        name: plan.name,
        note: plan.note,
        assignments: payloadOf(draft, starters),
      }),
    onSuccess: (version) => {
      onSaved(version, drafted);
      return queryClient.invalidateQueries({ queryKey: ['bgb'] });
    },
  });
  const live = useMutation({
    mutationFn: () => makeLive(plan.planId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bgb'] }),
  });
  const remove = useMutation({
    mutationFn: () => deletePlan(plan.planId),
    onSuccess: () => {
      onDeleted();
      return queryClient.invalidateQueries({ queryKey: ['bgb'] });
    },
  });

  const place = (playerId: string, objectiveKey: string, role: string) => {
    const next = new Map(draft);
    if (objectiveKey === '') next.delete(playerId);
    else next.set(playerId, { objectiveKey, role });
    setDraft(next);
  };

  // The picture shows the draft, so an officer sees the move before saving.
  const drafted: Assignment[] = starters.flatMap((s, ordinal) => {
    const p = draft.get(s.playerId);
    return p === undefined
      ? []
      : [
          {
            playerId: s.playerId,
            playerName: s.name,
            objectiveKey: p.objectiveKey,
            role: p.role,
            ordinal,
          },
        ];
  });

  return (
    <>
      <p className="subtle">
        {plan.isLive
          ? t('Live — members are reading this plan.')
          : t('Draft — members do not see it.')}{' '}
        {t('Last changed by {name}.', { name: plan.editedByName ?? t('someone') })}
        {readAt === null
          ? ` ${t('No signup list has been captured yet, so there are no starters to place.')}`
          : ` ${t(
              'Starters from the signup list read {time} ({age}) — it updates only when someone opens the Black Gold signup screen in game.',
              { time: new Date(readAt).toLocaleString(), age: formatAge(readAt, new Date(), t) },
            )}`}
      </p>
      {initial.dropped.length > 0 && (
        <p className="subtle">
          {t('No longer a starter, left out until you save: {names}.', {
            names: initial.dropped.join(', '),
          })}
        </p>
      )}

      <PlanPicture assignments={drafted} flipped={flipped} highlight={null} onFlip={setFlipped} />

      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">{t('Starter')}</th>
              <th scope="col">{t('Objective')}</th>
              <th scope="col">{t('Role')}</th>
            </tr>
          </thead>
          <tbody>
            {starters.map((s) => {
              const p = draft.get(s.playerId);
              return (
                <tr key={s.playerId}>
                  <th scope="row">{s.name}</th>
                  <td>
                    <select
                      aria-label={t('Objective for {name}', { name: s.name })}
                      onChange={(event) => place(s.playerId, event.target.value, p?.role ?? '')}
                      value={p?.objectiveKey ?? ''}
                    >
                      <option value="">—</option>
                      {PLAN_OBJECTIVES.map((o) => (
                        <option key={o.id} value={o.id}>
                          {t(o.label)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={t('Role for {name}', { name: s.name })}
                      disabled={p === undefined}
                      maxLength={40}
                      onChange={(event) =>
                        p !== undefined && place(s.playerId, p.objectiveKey, event.target.value)
                      }
                      placeholder={t('carry alloy, hold…')}
                      value={p?.role ?? ''}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hive-actions">
        <button disabled={!unsaved || save.isPending} onClick={() => save.mutate()} type="button">
          {save.isPending ? t('Saving…') : unsaved ? t('Save plan') : t('Saved')}
        </button>
        {!plan.isLive && (
          <button disabled={live.isPending || unsaved} onClick={() => live.mutate()} type="button">
            {t('Make this the live plan')}
          </button>
        )}
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(handout(plan.name, drafted, t));
            setCopied(true);
          }}
          type="button"
        >
          {copied ? t('Copied') : t('Copy for chat')}
        </button>
        <button
          disabled={remove.isPending}
          onClick={() => (confirming ? remove.mutate() : setConfirming(true))}
          type="button"
        >
          {confirming
            ? t('Delete {name}? It can be restored for 30 days.', { name: plan.name })
            : t('Delete this plan')}
        </button>
        {confirming && (
          <button onClick={() => setConfirming(false)} type="button">
            {t('Keep it')}
          </button>
        )}
      </div>
      {status === 'conflict' && !(save.error instanceof StaleSaveError) && (
        <p className="error">
          {rich(
            t(
              'Somebody else saved a newer version of this plan. Your changes here cannot be saved over it. {load} (your unsaved changes here will be lost).',
            ),
            {
              load: (
                <button onClick={onAdopt} type="button">
                  {t('Load their version')}
                </button>
              ),
            },
          )}
        </p>
      )}
      {save.error instanceof StaleSaveError ? (
        <p className="error">
          {rich(
            t(
              'Somebody else saved this plan after you opened it. {load} (your unsaved changes here will be lost).',
            ),
            {
              load: (
                <button
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ['bgb'] }).then(onAdopt);
                  }}
                  type="button"
                >
                  {t('Load their version')}
                </button>
              ),
            },
          )}
        </p>
      ) : save.error instanceof PlanDeletedError ? (
        <p className="error">
          {t('This plan was deleted. Restore it from “Recently deleted” to keep working on it.')}
        </p>
      ) : (
        save.error && <p className="error">{save.error.message}</p>
      )}
      {live.error && <p className="error">{live.error.message}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </>
  );
}
