// Home's reads. Every source is already member-readable (see the design,
// docs/superpowers/specs/2026-11-18-member-home-design.md §1), so no
// migration: these are narrower reads of tables other screens already use.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { objectiveLabel } from '../blackMoney/bgbPlan';

export interface MyPlayer {
  name: string | null;
  serverId: number;
}

export function useMyPlayer(playerId: string | null) {
  return useQuery({
    queryKey: ['home', 'player', playerId],
    enabled: playerId !== null,
    queryFn: async (): Promise<MyPlayer | null> => {
      const { data, error } = await supabase
        .from('players')
        .select('current_name, server_id')
        .eq('player_id', playerId ?? '')
        .maybeSingle();
      if (error) throw new Error(`player query failed: ${error.message}`);
      return data === null ? null : { name: data.current_name, serverId: data.server_id };
    },
  });
}

export interface MyBlackGold {
  readAt: string | null;
  row: { team_index: number | null; state: number | null } | null;
  /** My objective in my team's live battle plan, if it names me. */
  objective: { label: string; role: string; planName: string } | null;
}

/** Where I stand for Black Gold: my row in the alliance's newest signup
 * reading (0332's bgb_starters says which reading that is), and my place in
 * my team's live battle plan (0331). */
export function useMyBlackGold(playerId: string | null) {
  return useQuery({
    queryKey: ['home', 'black-gold', playerId],
    enabled: playerId !== null,
    queryFn: async (): Promise<MyBlackGold> => {
      const { data: read, error: readError } = await supabase.rpc('bgb_starters', {
        p_team_index: 1,
      });
      if (readError) throw new Error(`signup query failed: ${readError.message}`);
      const readAt = (read as { read_at: string | null } | null)?.read_at ?? null;
      if (readAt === null) return { readAt, row: null, objective: null };

      const { data: mine, error } = await supabase
        .from('black_money_signup_snapshots')
        .select('team_index, state')
        .eq('player_id', playerId ?? '')
        .eq('captured_at', readAt)
        .maybeSingle();
      if (error) throw new Error(`signup query failed: ${error.message}`);
      const row = mine ?? null;
      if (row?.team_index == null || row.state !== 1) return { readAt, row, objective: null };

      const { data: plan } = await supabase
        .from('bgb_plans')
        .select('name, bgb_plan_assignments(objective_key, role, player_id)')
        .eq('team_index', row.team_index)
        .eq('is_live', true)
        .is('deleted_at', null)
        .maybeSingle();
      const placed = plan?.bgb_plan_assignments.find((a) => a.player_id === playerId);
      return {
        readAt,
        row,
        objective:
          plan && placed
            ? {
                label: objectiveLabel(placed.objective_key),
                role: placed.role,
                planName: plan.name,
              }
            : null,
      };
    },
  });
}
