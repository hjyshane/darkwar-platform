// Game art for heroes, exclusive weapons, gear and items (0232).
//
// The icons are rows, not files: the art is the game company's, so it sits
// behind the same member-read RLS as the catalogue and comes down with the
// reader's session — a signed-out visitor or a viewer simply gets none, and
// every place that draws one shows its text alone. Small kinds (heroes,
// weapons, gear, resources, rank glyphs) come in one query each; items, ~1,370
// of them, by the ids a screen shows (0233). Held for the visit.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export type IconKind = 'hero' | 'exclusive' | 'gear' | 'item' | 'resource' | 'ui';

/** ref_id -> a data: URL, for the icons of one kind the reader may see —
 * all of them, or only the ids asked for (items: 1,370 of them, so a screen
 * asks for the ones it shows). */
export async function fetchIcons(
  kind: IconKind,
  ids?: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const refs: { ref_id: string; icon_key: string }[] = [];
  const batches = ids === undefined ? [undefined] : chunk([...new Set(ids)], 150);
  for (const batch of batches) {
    let query = supabase.from('game_icon_refs').select('ref_id, icon_key').eq('kind', kind);
    if (batch !== undefined) query = query.in('ref_id', batch);
    const { data, error } = await query.limit(1000);
    if (error) throw new Error(error.message);
    refs.push(...(data ?? []));
  }
  const keys = [...new Set(refs.map((r) => r.icon_key))];
  const images = new Map<string, string>();
  // 100 keys a request keeps the URL short; ~100 icons is one or two calls.
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error: iconError } = await supabase
      .from('game_icons')
      .select('icon_key, image')
      .in('icon_key', keys.slice(i, i + 100));
    if (iconError) throw new Error(iconError.message);
    for (const row of data ?? []) images.set(row.icon_key, `data:image/webp;base64,${row.image}`);
  }
  const out = new Map<string, string>();
  for (const ref of refs) {
    const src = images.get(ref.icon_key);
    if (src) out.set(ref.ref_id, src);
  }
  return out;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Item icons for the ids a screen shows. Nothing is asked for an empty list
 * or while `enabled` is false (a pack row still folded). */
export function useItemIcons(ids: ReadonlyArray<string>, enabled = true) {
  const key = [...new Set(ids)].sort().join(',');
  return useQuery({
    queryKey: ['game-icons', 'item', key],
    queryFn: () => fetchIcons('item', key === '' ? [] : key.split(',')),
    enabled: enabled && key !== '',
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 60_000,
  });
}

export function useIcons(kind: Exclude<IconKind, 'item'>) {
  return useQuery({
    queryKey: ['game-icons', kind],
    queryFn: () => fetchIcons(kind),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 60_000,
  });
}

/** The icon, or nothing — never a broken image. Decorative: the name it sits
 * beside is the label, so it carries an empty alt. */
export function GameIcon({ src, size = 24 }: { src: string | undefined; size?: number }) {
  if (!src) return null;
  return (
    <img
      alt=""
      className="game-icon"
      decoding="async"
      height={size}
      loading="lazy"
      src={src}
      width={size}
    />
  );
}
