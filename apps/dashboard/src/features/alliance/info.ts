// The alliance's info card: the newest get.al.info snapshot (0309's
// alliance_info_latest). `announce` arrives null unless the viewer belongs
// to the alliance; the view decides that per row, so nothing here does.

import type { Database } from '@dw/shared-types';
import { supabase } from '../../lib/supabase';
import type { AllianceVerdictFacts } from './verdict';

export type AllianceInfo = Database['public']['Views']['alliance_info_latest']['Row'];

export async function fetchAllianceInfo(allianceId: string): Promise<AllianceInfo | null> {
  const { data, error } = await supabase
    .from('alliance_info_latest')
    .select('*')
    .eq('alliance_id', allianceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The join rule for the verdict sentence.
 *
 * Always null for now: `join_approval` is the raw payload integer and whether
 * 1 means "needs approval" or "open join" is unconfirmed (the 0309 column
 * comment says how to confirm it). Until then the cell shows the raw value as
 * "Join (raw)" and the verdict carries only the minimums. This is the one
 * place to flip once the client has been checked. */
export function joinRuleOf(
  _info: Pick<AllianceInfo, 'join_approval'>,
): AllianceVerdictFacts['joinRule'] {
  return null;
}
