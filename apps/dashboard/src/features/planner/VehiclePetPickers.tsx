// The vehicle (its own level and its six parts) and the pets, from the login
// (0237). Read-only levels: a hand-entered account has none of these yet.
//
// A pet levels by its rarity's Food-like cost list ("pet", subject = rarity)
// and every tenth level is a cap a breakthrough lifts ("pet_break");
// goalsOf adds the breakthroughs a target crosses.

import { useQuery } from '@tanstack/react-query';
import { GameIcon, useIcons } from '../../lib/gameIcons';
import { petName, usePetCatalogue } from '../../lib/heroes';
import { LevelPicker } from './LevelPicker';
import type { Account } from './accounts';
import { fetchCatalogSubjects } from './data';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

const NO_TIERS: Tiers = new Map();

interface PickerProps {
  account: Account;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
}

function useMaxima(kind: 'vehicle' | 'vehicle_part' | 'pet') {
  return useQuery({
    queryKey: ['planner-catalog', kind, 'maxima'],
    queryFn: async () =>
      new Map((await fetchCatalogSubjects(kind, {})).map((s) => [s.subject, s] as const)),
    staleTime: 60 * 60_000,
  });
}

export function VehiclePicker({ account, targets, onSet }: PickerProps) {
  const vehicle = useMaxima('vehicle');
  const parts = useMaxima('vehicle_part');
  if (vehicle.isPending || parts.isPending) return <p className="empty">Loading the vehicle…</p>;
  if (vehicle.isError) return <p className="error">{vehicle.error.message}</p>;
  if (parts.isError) return <p className="error">{parts.error.message}</p>;
  if (account.vehicle.level === undefined) {
    return (
      <p className="empty">
        No vehicle on this account yet — it comes from a login (collector 1.6.0 or later).
      </p>
    );
  }
  const level = account.vehicle.level;
  const slots = [...parts.data.keys()].sort((a, b) => Number(a) - Number(b));
  return (
    <div className="table-wrap">
      <table className="compact planner-pick">
        <thead>
          <tr>
            <th className="label" scope="col">
              Vehicle
            </th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">
              Vehicle level
              {account.vehicle.exp ? (
                <span className="subtle"> · {account.vehicle.exp} exp toward the next</span>
              ) : null}
            </td>
            <td>
              <LevelPicker
                current={level}
                label="Vehicle level"
                max={vehicle.data.get('0')?.maxLevel ?? level}
                onChange={(to) =>
                  onSet({ kind: 'vehicle', subject: '0', name: 'Vehicle', from: level, to })
                }
                subject="vehicle"
                target={targets.get(targetKey('vehicle', '0'))?.to}
                tiers={NO_TIERS}
              />
            </td>
          </tr>
          {slots.map((slot) => {
            const part = parts.data.get(slot);
            const name = part?.name ?? `Part ${slot}`;
            const current = account.vehicleParts[slot] ?? 0;
            return (
              <tr key={slot}>
                <td className="label">{name}</td>
                <td>
                  <LevelPicker
                    current={current}
                    label={`${name} level`}
                    max={part?.maxLevel ?? current}
                    onChange={(to) =>
                      onSet({ kind: 'vehicle_part', subject: slot, name, from: current, to })
                    }
                    subject={`part:${slot}`}
                    target={targets.get(targetKey('vehicle_part', slot))?.to}
                    tiers={NO_TIERS}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PetPicker({ account, targets, onSet }: PickerProps) {
  const maxima = useMaxima('pet');
  const catalogue = usePetCatalogue();
  const icons = useIcons('pet');
  if (maxima.isPending || catalogue.isPending) return <p className="empty">Loading pets…</p>;
  if (maxima.isError) return <p className="error">{maxima.error.message}</p>;
  if (account.pets.length === 0) {
    return (
      <p className="empty">
        No pets on this account yet — they come from a login (collector 1.6.0 or later).
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="compact planner-pick">
        <thead>
          <tr>
            <th className="label" scope="col">
              Pet
            </th>
            <th scope="col">Breakthrough</th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {account.pets.map((pet) => {
            const rarity = catalogue.data?.get(pet.petId)?.rarity ?? null;
            const name = petName(catalogue.data, pet.petId);
            const key = `${pet.petId}:${rarity ?? 0}`;
            return (
              <tr key={pet.petId}>
                <td className="label">
                  <GameIcon size={22} src={icons.data?.get(String(pet.petId))} />
                  {name}
                </td>
                <td>{pet.breakthrough}</td>
                <td>
                  {rarity === null ? (
                    <span className="subtle">rarity unknown — run game-catalog</span>
                  ) : (
                    <LevelPicker
                      current={pet.level}
                      label={`${name} level`}
                      max={maxima.data.get(String(rarity))?.maxLevel ?? pet.level}
                      onChange={(to) =>
                        onSet({
                          kind: 'pet',
                          subject: key,
                          name,
                          from: pet.level,
                          to,
                          stageFrom: pet.breakthrough,
                        })
                      }
                      subject={`pet:${pet.petId}`}
                      target={targets.get(targetKey('pet', key))?.to}
                      tiers={NO_TIERS}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
