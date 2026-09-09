// Reading and writing a hive formation.
//
// EVERY WRITE THAT TOUCHES MORE THAN ONE TILE GOES THROUGH AN RPC, and that
// is not a style preference. The tables refuse two bases that share ground
// (0165), and a formation being edited passes through states that break that
// rule on the way to a valid one: shifting a shape one tile east overlaps
// every slot it replaces, and swapping two members is invalid halfway round
// in either order. Through PostgREST those are separate transactions, so
// there is no order of calls that works. 0167's two functions do the whole
// formation at once, and this file never reaches past them.
//
// Single-field edits — renaming, moving the anchor, marking a plan live — go
// straight at the table, because there is no halfway state to protect.

import { useQuery } from '@tanstack/react-query';
import type {
  AssignableMember,
  AssignableSlot,
  TileColour,
  TileKind,
} from '../../lib/hiveFormation';
import { supabase } from '../../lib/supabase';

export interface Formation {
  formationId: string;
  name: string;
  serverId: number;
  anchorX: number;
  anchorY: number;
  note: string;
  isActive: boolean;
  updatedAt: string;
}

/** One tile of a formation, with the member standing on it. */
export interface BoardSlot extends AssignableSlot {
  label: string;
  /** Tiles east-west and north-south. A base is 3x3; Frankie is 4x3; a marker
   * is 1x1. Since 0169 the size is on the row rather than assumed. */
  spanX: number;
  spanY: number;
  /** Ground or a person. A structure never carries a member. */
  kind: TileKind;
  colour: TileColour | null;
  /** The instruction: where this member teleports to. */
  x: number;
  y: number;
  playerId: string | null;
  playerName: string | null;
  hqLevel: number | null;
  power: number | null;
  /** False when the assigned member is off the newest roster. Null when the
   * tile is empty — nobody has left, because nobody was sent. */
  stillAMember: boolean | null;
  assignedAt: string | null;
}

export interface OccupiedTile {
  gameUid: number;
  playerId: string | null;
  name: string | null;
  x: number;
  y: number;
  hqLevel: number | null;
  capturedAt: string;
}

/** A refusal is an answer, not a crash — the same rule the rest of the app
 * follows. A reader the policy turns away gets an empty screen with its own
 * explanation rather than an error page about a status code. */
function emptyOnRefusal(code: string | undefined): boolean {
  return code === '42501';
}

export async function fetchFormations(serverId: number | null): Promise<Formation[]> {
  let request = supabase
    .from('hive_formations')
    .select('formation_id, name, server_id, anchor_x, anchor_y, note, is_active, updated_at')
    // Live plans first: the one being executed is the one somebody opening
    // this screen almost always came for.
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false });
  if (serverId !== null) {
    request = request.eq('server_id', serverId);
  }
  const { data, error } = await request.limit(100);
  if (error) {
    if (emptyOnRefusal(error.code)) {
      return [];
    }
    throw new Error(`formation query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    formationId: row.formation_id,
    name: row.name,
    serverId: row.server_id,
    anchorX: row.anchor_x,
    anchorY: row.anchor_y,
    note: row.note,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  }));
}

export function useFormations(serverId: number | null) {
  return useQuery({
    queryKey: ['hive', 'formations', serverId],
    queryFn: () => fetchFormations(serverId),
    staleTime: 60_000,
  });
}

/** The formation as a list of instructions.
 *
 * ONE ROW PER TILE, WHICH IS ONE ROW PER PERSON. 0166 folds the member into
 * the slot server-side for the reason this repo has hit twice: PostgREST caps
 * a response at 1,000 rows and ignores a bigger limit, so a row-per-detail
 * shape drops whole entities in silence rather than truncating visibly.
 */
export async function fetchBoard(formationId: string): Promise<BoardSlot[]> {
  const { data, error } = await supabase
    .from('hive_formation_board')
    .select(
      'slot_id, ordinal, label, dx, dy, x, y, span_x, span_y, kind, colour, player_id, player_name, hq_level, power, still_a_member, assigned_at',
    )
    .eq('formation_id', formationId)
    .order('ordinal')
    .limit(500);
  if (error) {
    if (emptyOnRefusal(error.code)) {
      return [];
    }
    throw new Error(`formation board query failed: ${error.message}`);
  }
  const slots: BoardSlot[] = [];
  for (const row of data ?? []) {
    // A view's columns are all nullable to the type generator no matter what
    // the query guarantees. Dropped rather than coerced: a slot without a
    // coordinate is not a place, and a zero here would be a tile at 0,0 that
    // somebody could be told to teleport to.
    if (
      row.slot_id === null ||
      row.dx === null ||
      row.dy === null ||
      row.x === null ||
      row.y === null
    ) {
      continue;
    }
    slots.push({
      slotId: row.slot_id,
      ordinal: row.ordinal ?? 0,
      label: row.label ?? '',
      spanX: row.span_x ?? 3,
      spanY: row.span_y ?? 3,
      kind: row.kind === 'structure' ? 'structure' : 'base',
      colour: (row.colour ?? null) as TileColour | null,
      dx: row.dx,
      dy: row.dy,
      x: row.x,
      y: row.y,
      playerId: row.player_id,
      playerName: row.player_name,
      hqLevel: row.hq_level,
      power: row.power === null ? null : Number(row.power),
      stillAMember: row.still_a_member,
      assignedAt: row.assigned_at,
    });
  }
  return slots;
}

export function useBoard(formationId: string | null) {
  return useQuery({
    queryKey: ['hive', 'board', formationId],
    queryFn: () => fetchBoard(formationId as string),
    enabled: formationId !== null,
    staleTime: 30_000,
  });
}

/** The people who can be sent somewhere.
 *
 * FROM `member_roster`, which joins through the roster view rather than
 * through `players.current_alliance_id`. That column is a last-known alliance
 * that nothing ever clears, so a picker built on it would offer every
 * departure since the beginning as somebody to assign a tile to.
 */
export async function fetchAssignableMembers(): Promise<AssignableMember[]> {
  const { data, error } = await supabase
    .from('member_roster')
    .select('player_id, current_name, power, hq_level, member_rank')
    .order('power', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) {
    if (emptyOnRefusal(error.code)) {
      return [];
    }
    throw new Error(`roster query failed: ${error.message}`);
  }
  const members: AssignableMember[] = [];
  for (const row of data ?? []) {
    if (row.player_id === null) {
      continue;
    }
    members.push({
      playerId: row.player_id,
      name: row.current_name,
      power: row.power === null ? null : Number(row.power),
      hqLevel: row.hq_level,
      memberRank: row.member_rank,
    });
  }
  return members;
}

export function useAssignableMembers() {
  return useQuery({
    queryKey: ['hive', 'members'],
    queryFn: fetchAssignableMembers,
    staleTime: 5 * 60_000,
  });
}

/** Bases already standing on the ground a formation is being drawn over.
 *
 * ADVISORY, NEVER A REFUSAL. A sighting is where a base WAS when the
 * collector last passed; the map tab's own warning applies here unchanged. A
 * tile that looks taken may be free, and a tile that looks free may not be —
 * so this shades the grid and says how old it is, and never stops a placement.
 * Refusing on stale evidence would be worse than the problem: it would block
 * ground that is genuinely empty.
 */
export async function fetchOccupiedTiles(
  serverId: number,
  box: { xMin: number; xMax: number; yMin: number; yMax: number },
): Promise<OccupiedTile[]> {
  const { data, error } = await supabase.rpc('world_cities_in_box', {
    p_server_id: serverId,
    p_x_min: box.xMin,
    p_x_max: box.xMax,
    p_y_min: box.yMin,
    p_y_max: box.yMax,
  });
  if (error) {
    if (emptyOnRefusal(error.code)) {
      return [];
    }
    throw new Error(`occupied tile query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    gameUid: Number(row.game_uid),
    playerId: row.player_id,
    name: row.name,
    x: row.x,
    y: row.y,
    hqLevel: row.hq_level,
    capturedAt: row.captured_at,
  }));
}

export function useOccupiedTiles(
  serverId: number | null,
  box: { xMin: number; xMax: number; yMin: number; yMax: number } | null,
) {
  return useQuery({
    queryKey: ['hive', 'occupied', serverId, box?.xMin, box?.xMax, box?.yMin, box?.yMax],
    queryFn: () => fetchOccupiedTiles(serverId as number, box as NonNullable<typeof box>),
    enabled: serverId !== null && box !== null,
    staleTime: 60_000,
  });
}

export interface LayoutSummary {
  slots: number;
  added: number;
  changed: number;
  removed: number;
  /** Members whose tile was deleted by this save. The number an officer has
   * to be told rather than discover on the next read. */
  unassigned: number;
}

export interface LayoutTile {
  dx: number;
  dy: number;
  ordinal: number;
  label: string;
  span_x: number;
  span_y: number;
  kind: TileKind;
  colour: TileColour | null;
}

export async function saveLayout(
  formationId: string,
  slots: readonly LayoutTile[],
): Promise<LayoutSummary> {
  const { data, error } = await supabase.rpc('save_hive_formation_layout', {
    p_formation_id: formationId,
    p_slots: slots as unknown as never,
  });
  if (error) {
    throw new Error(error.message);
  }
  const summary = (data ?? {}) as Partial<LayoutSummary>;
  return {
    slots: summary.slots ?? 0,
    added: summary.added ?? 0,
    changed: summary.changed ?? 0,
    removed: summary.removed ?? 0,
    unassigned: summary.unassigned ?? 0,
  };
}

export interface AssignmentSummary {
  assigned: number;
  cleared: number;
  changed: number;
}

export async function saveAssignments(
  formationId: string,
  assignments: ReadonlyArray<{ slot_id: string; player_id: string | null }>,
): Promise<AssignmentSummary> {
  const { data, error } = await supabase.rpc('assign_hive_formation_slots', {
    p_formation_id: formationId,
    p_assignments: assignments as unknown as never,
  });
  if (error) {
    throw new Error(error.message);
  }
  const summary = (data ?? {}) as Partial<AssignmentSummary>;
  return {
    assigned: summary.assigned ?? 0,
    cleared: summary.cleared ?? 0,
    changed: summary.changed ?? 0,
  };
}

export async function createFormation(input: {
  name: string;
  serverId: number;
  anchorX: number;
  anchorY: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from('hive_formations')
    .insert({
      name: input.name,
      server_id: input.serverId,
      anchor_x: input.anchorX,
      anchor_y: input.anchorY,
    })
    .select('formation_id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data.formation_id;
}

export async function updateFormation(
  formationId: string,
  patch: Partial<{
    name: string;
    anchorX: number;
    anchorY: number;
    note: string;
    isActive: boolean;
  }>,
): Promise<void> {
  // Named fields rather than a loose record: PostgREST's generated Update
  // type refuses an index signature, and it is right to — a typo in a key
  // would otherwise be sent to the server as a column nobody has.
  const row: {
    name?: string;
    anchor_x?: number;
    anchor_y?: number;
    note?: string;
    is_active?: boolean;
  } = {};
  if (patch.name !== undefined) {
    row.name = patch.name;
  }
  if (patch.anchorX !== undefined) {
    row.anchor_x = patch.anchorX;
  }
  if (patch.anchorY !== undefined) {
    row.anchor_y = patch.anchorY;
  }
  if (patch.note !== undefined) {
    row.note = patch.note;
  }
  if (patch.isActive !== undefined) {
    row.is_active = patch.isActive;
  }
  const { error } = await supabase
    .from('hive_formations')
    .update(row)
    .eq('formation_id', formationId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteFormation(formationId: string): Promise<void> {
  const { error } = await supabase.from('hive_formations').delete().eq('formation_id', formationId);
  if (error) {
    throw new Error(error.message);
  }
}

/** Only one formation per server may be live, and the database says so with a
 * unique index. Standing the new one up before sitting the old one down would
 * be refused, so the order here is not cosmetic.
 *
 * The old plan is stood down first even though that leaves a moment with no
 * live plan at all. The alternative is a moment with two, which is the state
 * where a member reads the wrong coordinate. */
export async function makeActive(formationId: string, serverId: number): Promise<void> {
  const { error: standDown } = await supabase
    .from('hive_formations')
    .update({ is_active: false })
    .eq('server_id', serverId)
    .eq('is_active', true)
    .neq('formation_id', formationId);
  if (standDown) {
    throw new Error(standDown.message);
  }
  await updateFormation(formationId, { isActive: true });
}
