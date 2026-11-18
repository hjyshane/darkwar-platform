// Reading and writing Black Gold plans (0331).
//
// Creating a plan is a direct insert; every change after that is a function
// that locks the plan and checks the version, as the hive's are (0330). The
// same error mapping applies, so the same two refusals — "somebody else
// saved" and "it was deleted" — reach the screen as typed errors.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { toWriteError } from '../hive/hiveSafety';
import type { Assignment, Starter } from './bgbPlan';

export interface BgbPlan {
  planId: string;
  teamIndex: number;
  name: string;
  note: string;
  isLive: boolean;
  version: number;
  editedAt: string;
  editedByName: string | null;
  deletedAt: string | null;
}

export function usePlans(teamIndex: number) {
  return useQuery({
    queryKey: ['bgb', 'plans', teamIndex],
    queryFn: async (): Promise<BgbPlan[]> => {
      const { data, error } = await supabase
        .from('bgb_plans')
        .select(
          'plan_id, team_index, name, note, is_live, version, edited_at, edited_by_name, deleted_at',
        )
        .eq('team_index', teamIndex)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(`plans query failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        planId: row.plan_id,
        teamIndex: row.team_index,
        name: row.name,
        note: row.note,
        isLive: row.is_live,
        version: row.version,
        editedAt: row.edited_at,
        editedByName: row.edited_by_name,
        deletedAt: row.deleted_at,
      }));
    },
  });
}

/** The team's starters in the newest signup reading on the alliance's server.
 *
 * One reading is one batch sharing one captured_at (0178), so "newest" is the
 * rows at the newest instant. The limit is far above one reading (an alliance
 * is under a hundred people), so the newest batch is always whole. */
export function useStarters(serverId: number | null, teamIndex: number) {
  return useQuery({
    queryKey: ['bgb', 'starters', serverId, teamIndex],
    enabled: serverId !== null,
    queryFn: async (): Promise<{ starters: Starter[]; readAt: string | null }> => {
      const { data, error } = await supabase
        .from('black_money_signup_snapshots')
        .select('player_id, name, power, captured_at, team_index, state')
        .eq('server_id', serverId ?? -1)
        .order('captured_at', { ascending: false })
        .limit(400);
      if (error) throw new Error(`signup query failed: ${error.message}`);
      const rows = data ?? [];
      const readAt = rows[0]?.captured_at ?? null;
      const starters: Starter[] = [];
      for (const row of rows) {
        if (row.captured_at !== readAt) break;
        if (row.team_index !== teamIndex || row.state !== 1 || row.player_id === null) continue;
        starters.push({ playerId: row.player_id, name: row.name ?? '?', power: row.power });
      }
      starters.sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
      return { starters, readAt };
    },
  });
}

export interface PlanDetail {
  version: number;
  assignments: Assignment[];
}

/** A plan's people together with the version they were read at — one request,
 * so the editor knows exactly which version its draft is built from. */
export function usePlanDetail(planId: string | null) {
  return useQuery({
    queryKey: ['bgb', 'detail', planId],
    enabled: planId !== null,
    queryFn: async (): Promise<PlanDetail | null> => {
      const { data, error } = await supabase
        .from('bgb_plans')
        .select(
          'version, bgb_plan_assignments(player_id, objective_key, role, ordinal, players(current_name))',
        )
        .eq('plan_id', planId ?? '')
        .maybeSingle();
      if (error) throw new Error(`plan query failed: ${error.message}`);
      if (data === null) return null;
      return {
        version: data.version,
        assignments: data.bgb_plan_assignments.map((row) => ({
          playerId: row.player_id,
          playerName: row.players?.current_name ?? null,
          objectiveKey: row.objective_key,
          role: row.role,
          ordinal: row.ordinal,
        })),
      };
    },
  });
}

export async function createPlan(teamIndex: number, name: string): Promise<string> {
  const { data, error } = await supabase
    .from('bgb_plans')
    .insert({ team_index: teamIndex, name })
    .select('plan_id')
    .single();
  if (error) throw new Error(error.message);
  return data.plan_id;
}

export async function savePlan(input: {
  planId: string;
  version: number;
  name: string;
  note: string;
  assignments: { objective_key: string; player_id: string; role: string; ordinal: number }[];
}): Promise<number> {
  const { data, error } = await supabase.rpc('save_bgb_plan', {
    p_plan_id: input.planId,
    p_version: input.version,
    p_name: input.name,
    p_note: input.note,
    p_assignments: input.assignments,
  });
  if (error) throw toWriteError(error);
  // The new version, so the editor moves its base before the refetch arrives
  // and does not mistake its own save for somebody else's.
  return (data as { version: number }).version;
}

async function call(
  fn: 'make_bgb_plan_live' | 'delete_bgb_plan' | 'restore_bgb_plan',
  planId: string,
) {
  const { error } = await supabase.rpc(fn, { p_plan_id: planId });
  if (error) throw toWriteError(error);
}

export const makeLive = (planId: string) => call('make_bgb_plan_live', planId);
export const deletePlan = (planId: string) => call('delete_bgb_plan', planId);
export const restorePlan = (planId: string) => call('restore_bgb_plan', planId);
