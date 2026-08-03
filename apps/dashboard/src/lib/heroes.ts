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
  /** 1 파랑 · 2 보라 · 3 노랑, the game's own order. Null means nobody has
   * established it — the catalogue never guesses one. */
  grade: number | null;
  notes: string;
}

/** Grade labels, in the game's words.
 *
 * The game names these by colour, so translating them ("Blue", "Rare") would
 * put a second vocabulary between the screen and the dashboard. They live
 * here rather than in the schema for the same reason TROOP_CLASSES does:
 * somebody read them off a screen.
 *
 * A grade we have not seen renders as its number instead of guessing — a
 * fourth grade is the kind of thing a season ships.
 */
export const HERO_GRADES: Record<number, string> = {
  1: '파랑',
  2: '보라',
  3: '노랑',
};

export function heroGradeName(grade: number | null): string {
  if (grade === null) {
    return '미정';
  }
  return HERO_GRADES[grade] ?? `등급 ${grade}`;
}

/** The class name for a hero's grade swatch, or null when there is nothing
 * to colour. Kept next to the label so the two never drift apart. */
export function heroGradeClass(grade: number | null): string | null {
  return grade === null ? null : `grade-${grade}`;
}

export type HeroCatalogue = ReadonlyMap<number, Hero>;

export async function fetchHeroes(): Promise<HeroCatalogue> {
  const { data, error } = await supabase
    .from('heroes')
    .select('hero_id, name, troop_class, grade, notes')
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

/** The pet catalogue. Same shape and same reason as the hero one — the
 * protocol carries no pet names either, and the list grows a pet at a time
 * (107 shipped recently), so it is a table an admin edits rather than a
 * constant somebody has to deploy. */
export interface Pet {
  pet_id: number;
  name: string | null;
  notes: string;
}

export type PetCatalogue = ReadonlyMap<number, Pet>;

export async function fetchPets(): Promise<PetCatalogue> {
  const { data, error } = await supabase.from('pets').select('pet_id, name, notes').order('pet_id');
  if (error) {
    throw new Error(`pet query failed: ${error.message}`);
  }
  return new Map((data ?? []).map((pet) => [pet.pet_id, pet as Pet]));
}

export function usePetCatalogue() {
  return useQuery({ queryKey: ['pets'], queryFn: fetchPets });
}

/** The name, or the id when nobody has typed one — same rule as heroName:
 * an unnamed pet is not a pet called "Pet 105". */
export function petName(catalogue: PetCatalogue | undefined, petId: number): string {
  const name = catalogue?.get(petId)?.name;
  return name != null && name.length > 0 ? name : String(petId);
}
