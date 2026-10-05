// One card per hero: its level, the gear it wears (level, and stage past
// level 100), and its exclusive weapon when it has one — each showing where
// it is now, each with a target to pick.
//
// On an account entered by hand (`onEdit`) every named hero gets a card, the
// levels now are inputs, and gear can be put on or taken off.
//
// Highest levels come from the per-subject summary (0222): heroes share the
// "hero" Food list, gear its quality's "level:q<n>" list and the shared
// "promote" stages, an exclusive weapon its hero's list.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { GameIcon, useIcons } from '../../lib/gameIcons';
import { heroGradeName } from '../../lib/heroes';
import { troopClassName } from '../../lib/troops';
import { LevelPicker } from './LevelPicker';
import { GearPromote, WeaponRank, gearPromoteText, weaponText } from './RankGlyphs';
import type { Account } from './accounts';
import { fetchCatalogSubjects, fetchHeroInfo } from './data';
import type { Tiers } from './levels';
import { type Target, targetKey } from './targets';

interface HeroCardsProps {
  account: Account;
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
  /** Set on a hand-entered account: the edited account. */
  onEdit?: (next: Account) => void;
}

const NO_TIERS: Tiers = new Map();

type Gear = Account['heroGear'][number];

export function HeroCards({ account, targets, onSet, onEdit }: HeroCardsProps) {
  const editing = onEdit !== undefined;
  const [gradeFilter, setGradeFilter] = useState<number | undefined | 'all'>('all');
  const [classFilter, setClassFilter] = useState<number | undefined | 'all'>('all');
  // Art for the cards (0232): nothing shows for a reader without it.
  const heroIcons = useIcons('hero');
  const gearIcons = useIcons('gear');
  const weaponIcons = useIcons('exclusive');
  const info = useQuery({
    queryKey: ['planner-heroes', account.playerId, editing],
    queryFn: () => fetchHeroInfo(account, editing),
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

  const ids = editing ? [...info.data.names.keys()] : Object.keys(account.heroLevels);
  // By the hero catalogue's grade (heroes.grade, the admin page; 3 yellow,
  // 2 purple, 1 blue — the same grade Arena shows), yellow first, and within
  // a grade the newest hero (the highest id) first: the heroes a player is
  // still raising. A hero nobody has graded comes last.
  const all = ids
    .map((id) => ({
      id,
      level: account.heroLevels[id] ?? 0,
      name: info.data.names.get(id) ?? `Hero ${id}`,
      grade: info.data.grade.get(id),
      troopClass: info.data.troopClass.get(id),
    }))
    .sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || Number(b.id) - Number(a.id));
  const grades = [...new Set(all.map((h) => h.grade))].sort((a, b) => (b ?? 0) - (a ?? 0));
  const classes = [...new Set(all.map((h) => h.troopClass))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const heroes = all.filter(
    (h) =>
      (gradeFilter === 'all' || h.grade === gradeFilter) &&
      (classFilter === 'all' || h.troopClass === classFilter),
  );
  const maxOf = (subject: string) => maxima.data.get(subject) ?? 0;

  const edit = (patch: Partial<Account>) => onEdit?.({ ...account, ...patch });
  const setGear = (index: number, patch: Partial<Gear>) =>
    edit({ heroGear: account.heroGear.map((g, i) => (i === index ? { ...g, ...patch } : g)) });

  return (
    <>
      <div aria-label="Hero grade" className="planner-tabs" role="tablist">
        <button
          aria-selected={gradeFilter === 'all'}
          onClick={() => setGradeFilter('all')}
          role="tab"
          type="button"
        >
          All ({all.length})
        </button>
        {grades.map((r) => (
          <button
            aria-selected={gradeFilter === r}
            className={r === undefined ? undefined : `chip-grade-${r}`}
            key={r ?? 'none'}
            onClick={() => setGradeFilter(r)}
            role="tab"
            type="button"
          >
            {heroGradeName(r ?? null)} ({all.filter((h) => h.grade === r).length})
          </button>
        ))}
      </div>
      <div aria-label="Hero class" className="planner-tabs" role="tablist">
        <button
          aria-selected={classFilter === 'all'}
          onClick={() => setClassFilter('all')}
          role="tab"
          type="button"
        >
          All classes
        </button>
        {classes.map((c) => (
          <button
            aria-selected={classFilter === c}
            key={c ?? 'none'}
            onClick={() => setClassFilter(c)}
            role="tab"
            type="button"
          >
            {c === undefined ? 'Class not set' : troopClassName(c)} (
            {all.filter((h) => h.troopClass === c).length})
          </button>
        ))}
      </div>
      <div className="planner-cards">
        {heroes.map((hero) => {
          const gear = account.heroGear
            .map((g, index) => ({ ...g, index }))
            .filter((g) => String(g.heroId) === hero.id);
          const weaponMax = info.data.exclusives.get(hero.id);
          const weapon = account.heroExclusives[hero.id] ?? 0;
          return (
            <article className="planner-card" key={hero.id}>
              <h4 className="planner-card-title">
                <GameIcon size={40} src={heroIcons.data?.get(hero.id)} />
                {hero.name}{' '}
                <span className={`rarity-tag chip-grade-${hero.grade ?? 'unknown'}`}>
                  {heroGradeName(hero.grade ?? null)}
                </span>
                {account.heroTrained.includes(hero.id) && (
                  <span
                    className="badge"
                    title="In the Training Center: held at the lowest level of the five highest heroes"
                  >
                    training center
                  </span>
                )}
              </h4>
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
                      onCurrent={
                        editing
                          ? (level) =>
                              edit({ heroLevels: { ...account.heroLevels, [hero.id]: level } })
                          : undefined
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
                      <dt className={`gear-quality-${quality}`}>
                        <GameIcon src={gearIcons.data?.get(String(g.equipId))} />
                        {piece?.name ?? `Gear ${g.equipId}`}
                        {editing && (
                          <button
                            aria-label={`Take off ${name}`}
                            className="link-button"
                            onClick={() =>
                              edit({ heroGear: account.heroGear.filter((_, i) => i !== g.index) })
                            }
                            type="button"
                          >
                            {' '}
                            ✕
                          </button>
                        )}
                      </dt>
                      <dd>
                        <LevelPicker
                          current={g.level}
                          label={`${name} level`}
                          max={maxOf(`level:q${quality}`)}
                          onChange={(to) => set(to, held?.stageTo ?? g.promote)}
                          onCurrent={editing ? (level) => setGear(g.index, { level }) : undefined}
                          subject={`level:q${quality}`}
                          target={held?.to}
                          tiers={NO_TIERS}
                        />
                        {/* Past 100 the game shows stage-ups and awakening, not a level. */}
                        {g.level >= 100 && (
                          <LevelPicker
                            current={g.promote}
                            glyph={(promote) => <GearPromote promote={promote} />}
                            label={`${name} stage`}
                            max={maxOf('promote')}
                            onChange={(stageTo) => set(held?.to ?? g.level, stageTo)}
                            onCurrent={
                              editing ? (promote) => setGear(g.index, { promote }) : undefined
                            }
                            subject="promote"
                            target={held?.stageTo}
                            text={gearPromoteText}
                            tiers={NO_TIERS}
                          />
                        )}
                      </dd>
                    </div>
                  );
                })}
                {editing && (
                  <div className="planner-card-row">
                    <dt>Add gear</dt>
                    <dd>
                      <select
                        aria-label={`Add gear to ${hero.name}`}
                        onChange={(e) => {
                          const equipId = Number(e.target.value);
                          if (!equipId) return;
                          edit({
                            heroGear: [
                              ...account.heroGear,
                              { equipId, heroId: Number(hero.id), level: 0, promote: 0 },
                            ],
                          });
                        }}
                        value=""
                      >
                        <option value="">Pick a piece…</option>
                        {[...info.data.gear.entries()]
                          .sort(
                            (a, b) =>
                              b[1].quality - a[1].quality || a[1].name.localeCompare(b[1].name),
                          )
                          .map(([equipId, piece]) => (
                            <option key={equipId} value={equipId}>
                              {piece.name}
                            </option>
                          ))}
                      </select>
                    </dd>
                  </div>
                )}
                {weaponMax !== undefined && (
                  <div className="planner-card-row">
                    <dt>
                      <GameIcon src={weaponIcons.data?.get(hero.id)} />
                      Exclusive weapon
                    </dt>
                    <dd>
                      <LevelPicker
                        current={weapon}
                        glyph={(level) => <WeaponRank level={level} />}
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
                        onCurrent={
                          editing
                            ? (level) =>
                                edit({
                                  heroExclusives: { ...account.heroExclusives, [hero.id]: level },
                                })
                            : undefined
                        }
                        subject={hero.id}
                        target={targets.get(targetKey('exclusive', hero.id))?.to}
                        text={weaponText}
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
    </>
  );
}
