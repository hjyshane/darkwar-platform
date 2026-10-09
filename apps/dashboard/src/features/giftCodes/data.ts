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
  /** The rank the game shows for them, 1 to 5 (R1 to R5), from the newest roster
   * capture. Null when it is not known: a rank is not guessed. */
  rank: number | null;
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

/** One row per roster member, so PostgREST's 1,000-row cap cannot drop anyone.
 *
 * The rank is not in `gift_member_status`; it is read from the roster view by
 * game id and put on each row here. If that read fails the list still comes back,
 * with no ranks: choosing by rank is a convenience, claiming is the job. */
export async function fetchGiftMembers(): Promise<GiftMember[]> {
  const { data, error } = await supabase.rpc('gift_member_status');
  if (error) {
    throw new Error(`gift members query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Omit<GiftMember, 'rank'>[];
  const ranks = await fetchRanks(rows.map((row) => row.game_uid));
  return rows.map((row) => ({ ...row, rank: ranks.get(row.game_uid) ?? null }));
}

async function fetchRanks(uids: number[]): Promise<Map<number, number>> {
  const ranks = new Map<number, number>();
  if (uids.length === 0) return ranks;
  const { data, error } = await supabase
    .from('alliance_roster_latest')
    .select('game_uid, member_rank, captured_at')
    .in('game_uid', uids)
    .order('captured_at', { ascending: true });
  if (error) return ranks;
  // Ascending, so the newest capture of a player who appears twice wins.
  for (const row of data ?? []) {
    if (row.game_uid !== null && row.member_rank !== null) ranks.set(row.game_uid, row.member_rank);
  }
  return ranks;
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

/** Delete a code from the list: this alliance's claims for it, and the code
 * itself once no alliance has a claim on it. Returns the claims removed. */
export async function deleteGiftCode(codeId: string): Promise<number> {
  const { data, error } = await supabase.rpc('delete_gift_code', { p_code_id: codeId });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? 0;
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
