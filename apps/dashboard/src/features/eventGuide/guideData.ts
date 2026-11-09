// Reads and writes for the event guides (0310).
//
// Guides, their sections and the score-item map are small (tens of rows), so
// each is one request with no paging. The catalogue is asked only for the ids
// a guide shows. Writes go through RLS: the 0078 guide.* capabilities decide,
// and an update or delete the policy filters out comes back as zero rows — so
// every write asks for the rows it touched and says so when there are none.

import type { Json } from '@dw/shared-types';
import { useQuery } from '@tanstack/react-query';
import { fetchIcons } from '../../lib/gameIcons';
import { supabase } from '../../lib/supabase';
import { fetchCalendar } from '../calendar/data';
import { type Account, fetchAccounts } from '../planner/accounts';
import type { GuideRow, ScheduleRow } from './guides';
import { type ScoreItemMap, scoreItemMapFrom } from './scoreItems';
import type { GuideSection } from './sections/index';
import { type ItemCatalogue, type ItemRef, catalogueFrom, itemRefKey } from './sections/itemRef';

const GUIDE_COLUMNS =
  'guide_id, activity_id, slug, title, title_ko, summary, summary_ko, starts_rule, published, post_id, updated_at';

export const GUIDES_KEY = ['event-guides'] as const;

async function fetchGuides(): Promise<GuideRow[]> {
  const { data, error } = await supabase.from('event_guides').select(GUIDE_COLUMNS).limit(500);
  if (error) throw new Error(`event guides query failed: ${error.message}`);
  return data ?? [];
}

export function useGuides() {
  return useQuery({ queryKey: GUIDES_KEY, queryFn: fetchGuides, staleTime: 5 * 60_000 });
}

async function fetchSections(guideId: string): Promise<GuideSection[]> {
  const { data, error } = await supabase
    .from('event_guide_sections')
    .select('section_id, guide_id, kind, title, sort_order, source, payload')
    .eq('guide_id', guideId)
    .order('sort_order')
    .limit(500);
  if (error) throw new Error(`guide sections query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...row,
    source: row.source === 'client' ? 'client' : 'officer',
  }));
}

export function useGuideSections(guideId: string | null) {
  return useQuery({
    queryKey: [...GUIDES_KEY, 'sections', guideId],
    queryFn: () => fetchSections(guideId as string),
    enabled: guideId !== null,
    staleTime: 5 * 60_000,
  });
}

async function fetchScoreItems(): Promise<ScoreItemMap> {
  const { data, error } = await supabase
    .from('game_event_score_items')
    .select('score_id, item_ref, per')
    .limit(1000);
  if (error) throw new Error(`score items query failed: ${error.message}`);
  return scoreItemMapFrom(data ?? []);
}

export function useScoreItems() {
  return useQuery({
    queryKey: [...GUIDES_KEY, 'score-items'],
    queryFn: fetchScoreItems,
    staleTime: 5 * 60_000,
  });
}

/** The game's calendar, under the calendar page's own key so the two share
 * one request. */
export function useGuideSchedule() {
  return useQuery({
    queryKey: ['event-calendar'],
    queryFn: fetchCalendar,
    staleTime: 5 * 60_000,
    select: (rows): ScheduleRow[] =>
      rows.map((row) => ({
        activity_id: row.activity_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
      })),
  });
}

export interface RefCatalogue {
  catalogue: ItemCatalogue;
  /** `itemRefKey` → a data: URL, for the refs the reader may see art for. */
  iconSrc: Map<string, string>;
}

export const EMPTY_CATALOGUE: RefCatalogue = {
  catalogue: { names: new Map(), icons: new Map() },
  iconSrc: new Map(),
};

function idsOf(refs: readonly ItemRef[], kind: ItemRef['kind']): string[] {
  return [...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id))].sort();
}

async function fetchRefCatalogue(refs: readonly ItemRef[]): Promise<RefCatalogue> {
  const items = idsOf(refs, 'item');
  const resources = idsOf(refs, 'resource')
    .map(Number)
    .filter((id) => Number.isInteger(id));
  const heroes = idsOf(refs, 'hero')
    .map(Number)
    .filter((id) => Number.isInteger(id));
  const none = { data: [], error: null };
  const [itemRows, resourceRows, heroRows] = await Promise.all([
    items.length > 0
      ? supabase.from('game_items').select('item_id, name').in('item_id', items).limit(1000)
      : none,
    resources.length > 0
      ? supabase.from('game_resources').select('resource_id, name').in('resource_id', resources)
      : none,
    heroes.length > 0
      ? supabase.from('heroes').select('hero_id, name').in('hero_id', heroes)
      : none,
  ]);
  for (const result of [itemRows, resourceRows, heroRows]) {
    if (result.error) throw new Error(`catalogue query failed: ${result.error.message}`);
  }
  const iconSrc = new Map<string, string>();
  // The art is behind its own policy (0232): a reader it turns away gets an
  // empty map and every chip shows its text alone.
  for (const kind of ['item', 'resource', 'hero'] as const) {
    const ids = idsOf(refs, kind);
    if (ids.length === 0) continue;
    try {
      for (const [id, src] of await fetchIcons(kind, ids)) iconSrc.set(`${kind}:${id}`, src);
    } catch {
      // No art is not an error for a page whose content is the text.
    }
  }
  return {
    catalogue: catalogueFrom({
      items: itemRows.data ?? [],
      resources: resourceRows.data ?? [],
      heroes: heroRows.data ?? [],
    }),
    iconSrc,
  };
}

export function useRefCatalogue(refs: readonly ItemRef[]) {
  const key = refs.map(itemRefKey).sort().join(',');
  return useQuery({
    queryKey: [...GUIDES_KEY, 'catalogue', key],
    queryFn: () => fetchRefCatalogue(refs),
    enabled: key !== '',
    staleTime: 60 * 60_000,
  });
}

/** The accounts the viewer may plan for — the planner's own query and key, so
 * the prep check uses the same gate and the same stock as the planner. */
export function useViewerAccounts() {
  return useQuery<Account[]>({
    queryKey: ['planner-accounts'],
    queryFn: fetchAccounts,
    staleTime: 5 * 60_000,
  });
}

export interface PickerResult {
  ref: ItemRef;
  name: string;
}

/** Items and resources whose English or Korean name contains `filter` (already
 * cleaned by `searchFilter`). Eight of each: a picker, not a browser. */
export async function searchItems(filter: string): Promise<PickerResult[]> {
  const pattern = `%${filter}%`;
  const [items, resources] = await Promise.all([
    supabase
      .from('game_items')
      .select('item_id, name')
      .or(`name.ilike.${pattern},name_ko.ilike.${pattern}`)
      .order('name')
      .limit(8),
    supabase
      .from('game_resources')
      .select('resource_id, name')
      .or(`name.ilike.${pattern},name_ko.ilike.${pattern}`)
      .order('name')
      .limit(8),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (resources.error) throw new Error(resources.error.message);
  return [
    ...(resources.data ?? []).map((row) => ({
      ref: { kind: 'resource' as const, id: String(row.resource_id) },
      name: row.name ?? `resource ${row.resource_id}`,
    })),
    ...(items.data ?? []).map((row) => ({
      ref: { kind: 'item' as const, id: row.item_id },
      name: row.name ?? `item ${row.item_id}`,
    })),
  ];
}

export interface BoardPost {
  guide_id: string;
  title: string;
}

/** Published posts on the 0078 board, for the "long-form post" link. */
export async function fetchBoardPosts(): Promise<BoardPost[]> {
  const { data, error } = await supabase
    .from('guides')
    .select('guide_id, title')
    .not('published_at', 'is', null)
    .order('title')
    .limit(200);
  if (error) {
    if (error.code === '42501') return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export function useBoardPosts(enabled = true) {
  return useQuery({
    queryKey: [...GUIDES_KEY, 'board-posts'],
    queryFn: fetchBoardPosts,
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ------------------------------------------------------------------- writes

const REFUSED = 'Nothing was changed: the database did not allow it for this account.';

export interface GuideInput {
  guide_id?: string;
  slug: string;
  title: string;
  title_ko: string | null;
  summary: string | null;
  summary_ko: string | null;
  starts_rule: Record<string, unknown>;
  published: boolean;
  post_id: string | null;
}

/** Insert, or update when `guide_id` is given. Returns the guide's id. */
export async function saveGuide(input: GuideInput): Promise<string> {
  const { guide_id, ...fields } = input;
  const row = { ...fields, starts_rule: fields.starts_rule as Json };
  const query =
    guide_id === undefined
      ? supabase.from('event_guides').insert(row).select('guide_id')
      : supabase.from('event_guides').update(row).eq('guide_id', guide_id).select('guide_id');
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const saved = data?.[0]?.guide_id;
  if (saved === undefined) throw new Error(REFUSED);
  return saved;
}

export async function deleteGuide(guideId: string): Promise<void> {
  const { data, error } = await supabase
    .from('event_guides')
    .delete()
    .eq('guide_id', guideId)
    .select('guide_id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Error(REFUSED);
}

export interface SectionInput {
  section_id?: string;
  guide_id: string;
  kind: string;
  title: string | null;
  sort_order: number;
  payload: unknown;
}

/** Insert an officer section, or update one. The importer's sections are not
 * written from here: the form never offers them for saving. */
export async function saveSection(input: SectionInput): Promise<string> {
  const { section_id, ...fields } = input;
  const row = { ...fields, source: 'officer', payload: fields.payload as Json };
  const query =
    section_id === undefined
      ? supabase.from('event_guide_sections').insert(row).select('section_id')
      : supabase
          .from('event_guide_sections')
          .update(row)
          .eq('section_id', section_id)
          .eq('source', 'officer')
          .select('section_id');
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const saved = data?.[0]?.section_id;
  if (saved === undefined) throw new Error(REFUSED);
  return saved;
}

export async function deleteSection(sectionId: string): Promise<void> {
  const { data, error } = await supabase
    .from('event_guide_sections')
    .delete()
    .eq('section_id', sectionId)
    .select('section_id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Error(REFUSED);
}

/** Map a client score id to the item it consumes. One row serves every event
 * that reuses the id. */
export async function saveScoreItem(scoreId: string, ref: ItemRef, per = 1): Promise<void> {
  const { data, error } = await supabase
    .from('game_event_score_items')
    .upsert(
      { score_id: scoreId, item_ref: ref as unknown as Json, per },
      { onConflict: 'score_id' },
    )
    .select('score_id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Error(REFUSED);
}

export async function clearScoreItem(scoreId: string): Promise<void> {
  const { data, error } = await supabase
    .from('game_event_score_items')
    .delete()
    .eq('score_id', scoreId)
    .select('score_id');
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new Error(REFUSED);
}
