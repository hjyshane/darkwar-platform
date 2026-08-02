import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** The hero catalogue: id to name, filled in by hand.
 *
 * Nothing on the wire carries a hero's name. The server sends localisation
 * keys — push.refresh.hero.lottery gives `"name": "483491"` — and the text
 * lives in the APK, so the catalogue is typed on the admin page rather than
 * captured. That is why this is a query against a table and not a constant
 * beside TROOP_CLASSES: a hero named next season is a row, not a deploy.
 */
export interface Hero {
  hero_id: number;
  name: string | null;
  troop_class: number | null;
  notes: string;
}

export type HeroCatalogue = ReadonlyMap<number, Hero>;

export async function fetchHeroes(): Promise<HeroCatalogue> {
  const { data, error } = await supabase
    .from('heroes')
    .select('hero_id, name, troop_class, notes')
    .order('hero_id');
  if (error) {
    throw new Error(`hero query failed: ${error.message}`);
  }
  return new Map((data ?? []).map((hero) => [hero.hero_id, hero as Hero]));
}

/** Shared across every lineup cell on the board. A Top100 page renders a
 * hundred of these; the query key is what keeps that one request. */
export function useHeroCatalogue() {
  return useQuery({ queryKey: ['heroes'], queryFn: fetchHeroes });
}

/** The name, or the id when nobody has typed one yet.
 *
 * Not "Hero 1004" as a name — an unnamed hero is not a hero called Hero.
 * The id is what the payload gave us and it is a real answer; showing it
 * plainly also makes the gap in the catalogue visible to whoever can close
 * it, which a placeholder would hide.
 */
export function heroName(catalogue: HeroCatalogue | undefined, heroId: number): string {
  const name = catalogue?.get(heroId)?.name;
  return name != null && name.length > 0 ? name : String(heroId);
}
