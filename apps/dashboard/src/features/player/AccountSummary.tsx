// The character's own account at its last login: squads 1-4, the vehicle and
// the pets (0236, 0237). account_state is owner-or-admin under RLS (0205), so
// for anybody else the query comes back empty and the page offers no tab.

import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { GameIcon, useIcons } from '../../lib/gameIcons';
import { heroName, petName, useHeroCatalogue, usePetCatalogue } from '../../lib/heroes';
import { supabase } from '../../lib/supabase';
import { GearPromote, WeaponRank } from '../planner/RankGlyphs';
import { fetchCatalogSubjects } from '../planner/data';

export interface AccountState {
  capturedAt: string;
  heroLevels: Record<string, number>;
  squads: { index: number; heroes: number[] }[];
  gear: { equipId: number; heroId: number | null; level: number; promote: number }[];
  exclusives: Record<string, number>;
  vehicleParts: Record<string, number>;
  vehicle: { level?: number; exp?: number; suit_level?: number };
  pets: { pet_id: number; level: number; breakthrough: number; training: Record<string, number> }[];
}

const asRecord = (v: unknown) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
const asList = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

export async function fetchAccountState(playerId: string): Promise<AccountState | null> {
  const { data, error } = await supabase
    .from('account_state_latest')
    .select(
      'captured_at, hero_levels, hero_squads, hero_equips, hero_exclusives, mod_car_equips, vehicle, pets',
    )
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    capturedAt: data.captured_at ?? '',
    heroLevels: asRecord(data.hero_levels),
    squads: asList(data.hero_squads),
    gear: asList(data.hero_equips),
    exclusives: asRecord(data.hero_exclusives),
    vehicleParts: asRecord(data.mod_car_equips),
    vehicle: asRecord(data.vehicle),
    pets: asList(data.pets),
  };
}

export function useAccountState(playerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['account-state', playerId],
    queryFn: () => fetchAccountState(playerId),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function HeroLine({ heroId, state }: { heroId: number; state: AccountState }) {
  const { data: catalogue } = useHeroCatalogue();
  const heroIcons = useIcons('hero');
  const gearIcons = useIcons('gear');
  const id = String(heroId);
  const gear = state.gear.filter((g) => g.heroId === heroId);
  const weapon = state.exclusives[id] ?? 0;
  return (
    <li className="squad-hero">
      <GameIcon size={36} src={heroIcons.data?.get(id)} />
      <span className="squad-hero-name">
        <strong>{heroName(catalogue, heroId)}</strong>
        <span className="subtle"> Lv {state.heroLevels[id] ?? '—'}</span>
      </span>
      {weapon > 0 && <WeaponRank level={weapon} />}
      <span className="squad-gear">
        {gear.map((g) => (
          <span className="squad-gear-piece" key={`${g.equipId}:${g.level}:${g.promote}`}>
            <GameIcon size={18} src={gearIcons.data?.get(String(g.equipId))} />
            {g.level >= 100 ? <GearPromote promote={g.promote} /> : `Lv ${g.level}`}
          </span>
        ))}
      </span>
    </li>
  );
}

export function SquadsSummary({ state }: { state: AccountState }) {
  const placed = new Set(state.squads.flatMap((s) => s.heroes));
  const benched = Object.keys(state.heroLevels)
    .map(Number)
    .filter((id) => !placed.has(id))
    .sort((a, b) => (state.heroLevels[String(b)] ?? 0) - (state.heroLevels[String(a)] ?? 0));
  if (state.squads.length === 0) {
    return <p className="empty">No squads in this login yet — they arrive with the next one.</p>;
  }
  return (
    <div className="squad-grid">
      {state.squads.map((squad) => (
        <section className="planner-card" key={squad.index}>
          <h3>Squad {squad.index}</h3>
          {squad.heroes.length === 0 ? (
            <p className="empty">Empty.</p>
          ) : (
            <ul className="squad-list">
              {squad.heroes.map((heroId) => (
                <HeroLine heroId={heroId} key={heroId} state={state} />
              ))}
            </ul>
          )}
        </section>
      ))}
      <details className="planner-card squad-bench">
        <summary>
          <h3>In no squad ({benched.length})</h3>
        </summary>
        <ul className="squad-list">
          {benched.map((heroId) => (
            <HeroLine heroId={heroId} key={heroId} state={state} />
          ))}
        </ul>
      </details>
    </div>
  );
}

export function VehicleSummary({ state }: { state: AccountState }) {
  const parts = useQuery({
    queryKey: ['planner-catalog', 'vehicle_part', 'maxima'],
    queryFn: async () =>
      new Map((await fetchCatalogSubjects('vehicle_part', {})).map((s) => [s.subject, s] as const)),
    staleTime: 60 * 60_000,
  });
  if (state.vehicle.level === undefined) {
    return <p className="empty">No vehicle in this login yet — it arrives with the next one.</p>;
  }
  const slots = Object.keys(state.vehicleParts).sort((a, b) => Number(a) - Number(b));
  return (
    <>
      <div className="stats">
        <StatTile hero label="Vehicle level" value={state.vehicle.level} />
        {state.vehicle.suit_level !== undefined && (
          <StatTile label="Part set level" value={state.vehicle.suit_level} />
        )}
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Part
              </th>
              <th scope="col">Level</th>
              <th scope="col">Max</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot}>
                <td className="label">{parts.data?.get(slot)?.name ?? `Part ${slot}`}</td>
                <td>{state.vehicleParts[slot]}</td>
                <td className="subtle">{parts.data?.get(slot)?.maxLevel ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PetsSummary({ state }: { state: AccountState }) {
  const { data: catalogue } = usePetCatalogue();
  const icons = useIcons('pet');
  if (state.pets.length === 0) {
    return <p className="empty">No pets in this login yet — they arrive with the next one.</p>;
  }
  const attrs = [...new Set(state.pets.flatMap((p) => Object.keys(p.training ?? {})))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th className="label" scope="col">
              Pet
            </th>
            <th scope="col">Level</th>
            <th scope="col">Breakthrough</th>
            {attrs.map((a) => (
              <th key={a} scope="col" title="Training, by attribute as the game numbers it">
                Training {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.pets.map((pet) => (
            <tr key={pet.pet_id}>
              <td className="label">
                <GameIcon size={22} src={icons.data?.get(String(pet.pet_id))} />
                {petName(catalogue, pet.pet_id)}
              </td>
              <td>{pet.level}</td>
              <td>{pet.breakthrough}</td>
              {attrs.map((a) => (
                <td key={a}>{pet.training?.[a] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
