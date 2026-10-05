// Game art for heroes, exclusive weapons, gear and items (0232).
//
// The icons are rows, not files: the art is the game company's, so it sits
// behind the same member-read RLS as the catalogue and comes down with the
// reader's session — a signed-out visitor or a viewer simply gets none, and
// every place that draws one shows its text alone. One query per kind, held
// for the visit; the first batch is ~100 icons at ~260 KB.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export type IconKind = 'hero' | 'exclusive' | 'gear' | 'item';

/** ref_id -> a data: URL, for every icon of one kind the reader may see. */
export async function fetchIcons(kind: IconKind): Promise<Map<string, string>> {
  const { data: refs, error } = await supabase
    .from('game_icon_refs')
    .select('ref_id, icon_key')
    .eq('kind', kind)
    .limit(1000);
  if (error) throw new Error(error.message);
  const keys = [...new Set((refs ?? []).map((r) => r.icon_key))];
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
  for (const ref of refs ?? []) {
    const src = images.get(ref.icon_key);
    if (src) out.set(ref.ref_id, src);
  }
  return out;
}

export function useIcons(kind: IconKind) {
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
