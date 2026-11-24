// The reader's saved plans (0341), as My account lists them: what each one
// raises, which account it was made for, and a link that reopens it in the
// planner. Deleting is here and nowhere else, behind a second click.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { rich, useT } from '../../lib/i18n';
import { chipLabel } from '../calculator/chips';
import { fetchTiers } from './data';
import { levelText } from './levels';
import { type SavedPlan, deletePlan, fetchPlans, planHash, targetText } from './plans';
import type { Target } from './targets';

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export function useSavedPlans(enabled = true) {
  return useQuery({
    queryKey: ['planner-plans'],
    queryFn: fetchPlans,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function SavedPlans() {
  const t = useT();
  const plans = useSavedPlans();
  // A building's level is drawn as the game names it (a tier past 30).
  const tiers = useQuery({
    queryKey: ['planner-tiers'],
    queryFn: fetchTiers,
    staleTime: 60 * 60_000,
  });
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: deletePlan,
    onSuccess: async () => {
      setAsking(null);
      await queryClient.invalidateQueries({ queryKey: ['planner-plans'] });
    },
  });

  if (plans.isPending) return <p className="empty loading">{t('Loading…')}</p>;
  if (plans.isError)
    return (
      <p className="error">
        {t('Could not load plans: {message}', { message: plans.error.message })}
      </p>
    );
  if (plans.data.length === 0) {
    return (
      <p className="empty">
        {rich(
          t('No saved plan yet. Choose what to raise in the {planner} and save it under a name.'),
          {
            planner: <a href="#/planner">{t('Planner')}</a>,
          },
        )}
      </p>
    );
  }

  const tierMap = tiers.data ?? new Map();
  const shown = (target: Target, level: number) =>
    target.kind === 'building'
      ? levelText(tierMap, target.subject, level)
      : target.kind === 'chip'
        ? chipLabel(level)
        : String(level);

  return (
    <ul className="board-list saved-plans">
      {plans.data.map((plan: SavedPlan) => (
        <li key={plan.planId}>
          <a href={planHash(plan.planId)}>{plan.name}</a>
          <div className="post-meta">
            {plan.accountName !== '' && <span className="post-tag">{plan.accountName}</span>}
            <span>
              {plan.targets.length === 1
                ? t('{count} upgrade', { count: plan.targets.length })
                : t('{count} upgrades', { count: plan.targets.length })}
            </span>
            <time dateTime={plan.updatedAt}>
              {t('saved {date}', { date: day.format(new Date(plan.updatedAt)) })}
            </time>
          </div>
          <ul className="chips saved-plan-targets">
            {plan.targets.map((target) => (
              <li className="saved-plan-target" key={`${target.kind}:${target.subject}`}>
                {targetText(target, shown, t)}
              </li>
            ))}
          </ul>
          <div className="row saved-plan-actions">
            <a href={planHash(plan.planId)}>{t('Open in the planner')}</a>
            {asking === plan.planId ? (
              <>
                <button
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(plan.planId)}
                  type="button"
                >
                  {remove.isPending ? t('Deleting…') : t('Yes, delete it')}
                </button>
                <button onClick={() => setAsking(null)} type="button">
                  {t('Keep it')}
                </button>
              </>
            ) : (
              <button onClick={() => setAsking(plan.planId)} type="button">
                {t('Delete')}
              </button>
            )}
          </div>
          {remove.isError && asking === plan.planId && (
            <p className="error">
              {t('Could not delete it: {message}', { message: remove.error.message })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
