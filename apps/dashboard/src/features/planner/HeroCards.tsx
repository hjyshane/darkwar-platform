// One card per hero: its level, the gear it wears (level, and stage past
// level 100), and its exclusive weapon when it has one — each showing where
// it is now, each with a target to pick.
//
// Highest levels come from the per-subject summary (0222): heroes share the
// "hero" Food list, gear its quality's "level:q<n>" list and the shared
// "promote" stages, an exclusive weapon its hero's list.

import { useQuery } from '@tanstack/react-query';
import { LevelPicker } from './LevelPicker';
import { type Account, fetchCatalogSubjects, fetchHeroInfo } from './data';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

interface HeroCardsProps {
  account: Account;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
}

const NO_TIERS: Tiers = new Map();

export function HeroCards({ account, targets, onSet }: HeroCardsProps) {
  const info = useQuery({
    queryKey: ['planner-heroes', account.playerId],
    queryFn: () => fetchHeroInfo(account),
    staleTime: 10 * 60_000,
  });
  const maxima = useQuery({
    queryKey: ['planner-catalog', 'hero-maxima'],
    queryFn: async () => {
      const [hero, gear] = await Promise.all([
        fetchCatalogSubjects('hero', {}),
        fetchCatalogSubjects('hero_gear', {}),
      ]);
      return new Map([...hero, ...gear].map((s) => [s.subject, s.maxLevel]));
    },
    staleTime: 60 * 60_000,
  });

  if (info.isPending || maxima.isPending) return <p className="empty">Loading heroes…</p>;
  if (info.isError) return <p className="error">{info.error.message}</p>;
  if (maxima.isError) return <p className="error">{maxima.error.message}</p>;

  const heroes = Object.entries(account.heroLevels)
    .map(([id, level]) => ({ id, level, name: info.data.names.get(id) ?? `Hero ${id}` }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const maxOf = (subject: string) => maxima.data.get(subject) ?? 0;

  return (
    <div className="planner-cards">
      {heroes.map((hero) => {
        const gear = account.heroGear
          .map((g, index) => ({ ...g, index }))
          .filter((g) => String(g.heroId) === hero.id);
        const weaponMax = info.data.exclusives.get(hero.id);
        const weapon = account.heroExclusives[hero.id] ?? 0;
        return (
          <article className="planner-card" key={hero.id}>
            <h4>{hero.name}</h4>
            <dl>
              <div className="planner-card-row">
                <dt>Level</dt>
                <dd>
                  <LevelPicker
                    current={hero.level}
                    label={`${hero.name} level`}
                    max={maxOf('hero')}
                    onChange={(to) =>
                      onSet({
                        kind: 'hero',
                        subject: hero.id,
                        name: hero.name,
                        from: hero.level,
                        to,
                      })
                    }
                    subject="hero"
                    target={targets.get(targetKey('hero', hero.id))?.to}
                    tiers={NO_TIERS}
                  />
                </dd>
              </div>
              {gear.map((g) => {
                const piece = info.data.gear.get(g.equipId);
                const quality = piece?.quality ?? 0;
                const subject = `${g.index}:${g.equipId}:${quality}`;
                const held = targets.get(targetKey('hero_gear', subject));
                const name = `${hero.name} · ${piece?.name ?? `Gear ${g.equipId}`}`;
                const set = (to: number, stageTo: number) =>
                  onSet({
                    kind: 'hero_gear',
                    subject,
                    name,
                    from: g.level,
                    to,
                    stageFrom: g.promote,
                    stageTo,
                  });
                return (
                  <div className="planner-card-row" key={subject}>
                    <dt>{piece?.name ?? `Gear ${g.equipId}`}</dt>
                    <dd>
                      <LevelPicker
                        current={g.level}
                        label={`${name} level`}
                        max={maxOf(`level:q${quality}`)}
                        onChange={(to) => set(to, held?.stageTo ?? g.promote)}
                        subject={`level:q${quality}`}
                        target={held?.to}
                        tiers={NO_TIERS}
                      />
                      <span className="subtle"> stage </span>
                      <LevelPicker
                        current={g.promote}
                        label={`${name} stage`}
                        max={maxOf('promote')}
                        onChange={(stageTo) => set(held?.to ?? g.level, stageTo)}
                        subject="promote"
                        target={held?.stageTo}
                        tiers={NO_TIERS}
                      />
                    </dd>
                  </div>
                );
              })}
              {weaponMax !== undefined && (
                <div className="planner-card-row">
                  <dt>Exclusive weapon</dt>
                  <dd>
                    <LevelPicker
                      current={weapon}
                      label={`${hero.name} exclusive weapon`}
                      max={weaponMax}
                      onChange={(to) =>
                        onSet({
                          kind: 'exclusive',
                          subject: hero.id,
                          name: `${hero.name} · exclusive weapon`,
                          from: weapon,
                          to,
                        })
                      }
                      subject={hero.id}
                      target={targets.get(targetKey('exclusive', hero.id))?.to}
                      tiers={NO_TIERS}
                    />
                  </dd>
                </div>
              )}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
