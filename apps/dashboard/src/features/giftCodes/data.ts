import { supabase } from '../../lib/supabase';

/** One code with its counts for the alliance on screen, from `gift_code_progress` (0251). */
export interface GiftCode {
  code_id: string;
  code: string;
  status: 'unverified' | 'working' | 'expired' | 'invalid';
  source: 'officer' | 'scan';
  first_seen_at: string;
  checked_at: string | null;
  /** Roster members who are not excluded: what "everyone" means right now. */
  members: number;
  queued: number;
  running: number;
  done: number;
  already: number;
  failed: number;
  other: number;
}

/** One roster member, from `gift_member_status`: a row per PERSON, with a map
 * from code id to the status of that pair. */
export interface GiftMember {
  game_uid: number;
  name: string;
  excluded: boolean;
  claims: Record<string, string>;
}

/** The database-side sender (0252), from `gift_runner_status`. */
export interface GiftRunner {
  enabled: boolean;
  /** Set while it is waiting out a run of non-answers. */
  paused_until: string | null;
  /** Why it last turned itself (or an officer) off. */
  halted_reason: string | null;
  last_sent_at: string | null;
}

// The generated types call every returned column non-null, which is what the
// CLI emits for `returns table` and not what the functions return - hence the
// casts to the hand-written shapes above.

export async function fetchGiftCodes(): Promise<GiftCode[]> {
  const { data, error } = await supabase.rpc('gift_code_progress');
  if (error) {
    throw new Error(`gift codes query failed: ${error.message}`);
  }
  return (data ?? []) as GiftCode[];
}

/** One row per roster member, so PostgREST's 1,000-row cap cannot drop anyone. */
export async function fetchGiftMembers(): Promise<GiftMember[]> {
  const { data, error } = await supabase.rpc('gift_member_status');
  if (error) {
    throw new Error(`gift members query failed: ${error.message}`);
  }
  return (data ?? []) as GiftMember[];
}

export async function addGiftCode(code: string): Promise<void> {
  const { error } = await supabase.rpc('add_gift_code', { p_code: code });
  if (error) {
    throw new Error(error.message);
  }
}

export async function setGiftCodeStatus(codeId: string, status: GiftCode['status']): Promise<void> {
  const { error } = await supabase.rpc('set_gift_code_status', {
    p_code_id: codeId,
    p_status: status,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function setGiftExclusion(gameUid: number, excluded: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_gift_exclusion', {
    p_game_uid: gameUid,
    p_excluded: excluded,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Queue the codes for the whole roster (`gameUids` omitted) or the players
 * named. Returns how many pairs were queued; excluded players never are. */
export async function enqueueGiftClaims(codeIds: string[], gameUids?: number[]): Promise<number> {
  const { data, error } = await supabase.rpc('enqueue_gift_claims', {
    p_code_ids: codeIds,
    ...(gameUids === undefined ? {} : { p_game_uids: gameUids }),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? 0;
}

export async function cancelGiftClaims(codeId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_gift_claims', { p_code_id: codeId });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? 0;
}

export async function fetchGiftRunner(): Promise<GiftRunner | null> {
  const { data, error } = await supabase.rpc('gift_runner_status');
  if (error) {
    throw new Error(`gift sender query failed: ${error.message}`);
  }
  return ((data ?? [])[0] as GiftRunner | undefined) ?? null;
}

export async function setGiftRunner(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_gift_runner_enabled', { p_enabled: enabled });
  if (error) {
    throw new Error(error.message);
  }
}
