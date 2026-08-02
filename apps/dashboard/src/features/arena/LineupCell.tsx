import { useState } from 'react';
import {
  type HeroCatalogue,
  heroGradeClass,
  heroGradeName,
  heroName,
  useHeroCatalogue,
} from '../../lib/heroes';
import {
  type LineupHero,
  bySlot,
  composition,
  isMaxStar,
  isWeaponAwakened,
  starsShown,
  synergy,
  troopClassInitial,
  troopClassName,
  weaponRankLabel,
} from '../../lib/troops';

const numberFormat = new Intl.NumberFormat('ko-KR');

function detail(hero: LineupHero, catalogue: HeroCatalogue | undefined): string {
  const stars = starsShown(hero.star);
  const grade = catalogue?.get(hero.hero_id)?.grade ?? null;
  return [
    hero.slot === null ? 'Slot ?' : `Slot ${hero.slot}`,
    heroName(catalogue, hero.hero_id),
    // Named, not just coloured. The bar under the chip is the only place a
    // grade is visible without expanding, and a colour on its own is not a
    // readable answer to "which grade is that".
    grade === null ? null : heroGradeName(grade),
    troopClassName(hero.troop_class),
    hero.hero_level === null ? null : `Lv ${hero.hero_level}`,
    stars === null ? null : `${stars}★`,
    // Only present below the cap, which is where it means anything.
    hero.stage === null ? null : `step ${hero.stage}`,
    // The dot on the chip says a weapon exists and whether it has gone past
    // five stars into 각; the tooltip is where the actual figure lives.
    hero.weapon_level === null ? null : `전용무기 ${weaponRankLabel(hero.weapon_level)}`,
    hero.hero_power === null ? null : numberFormat.format(hero.hero_power),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** A defence lineup: five class chips, expanding to the detail behind them.
 *
 * Chips rather than hero names in the collapsed cell, because the class is
 * what you counter and five letters fit where five names do not. The names
 * themselves come from the catalogue an admin types (0037) — the protocol
 * carries none, so an id with no row yet prints as the id.
 *
 * The expansion exists because the arena screen shows more than a roster:
 * level, star, the hero's exclusive weapon, four equipment pieces with their
 * own levels, and skill levels. All of that is decoded, and collapsing it to
 * five letters would throw away the reason for decoding it.
 */
export function LineupCell({ heroes }: { heroes: readonly LineupHero[] }) {
  const [open, setOpen] = useState(false);
  const { data: catalogue } = useHeroCatalogue();

  if (heroes.length === 0) {
    // Not a lineup of nobody — no `army` was decoded for this entry, which is
    // the same em dash every other unknown in these tables uses.
    return <>—</>;
  }
  const ordered = bySlot(heroes);
  // Three of a class is the thing worth seeing at a glance, because it is
  // what changes the fight — and what tells you which lineup of your own to
  // send. Counting five chips by eye every row is exactly the work a screen
  // should be doing.
  const bonus = synergy(heroes);
  return (
    <details className="lineup-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="lineup" title={composition(heroes)}>
          {ordered.map((hero) => (
            <span
              className={[
                'chip',
                // Fill is the GRADE. The class is the letter inside it, which
                // already said Fighter/Shooter/Rider — spending the loudest
                // channel on something already stated left grade with none.
                // No fill for a hero whose grade nobody has set: the neutral
                // default reads as "not established", not as a fourth grade.
                `chip-grade-${catalogue?.get(hero.hero_id)?.grade ?? 'unknown'}`,
                isMaxStar(hero.star) ? 'chip-max-star' : null,
                hero.weapon_level === null ? null : 'chip-weapon',
                isWeaponAwakened(hero.weapon_level) ? 'chip-weapon-awakened' : null,
                bonus !== null && hero.troop_class === bonus.troopClass ? 'chip-synergy' : null,
              ]
                .filter(Boolean)
                .join(' ')}
              key={`${hero.slot}-${hero.hero_id}`}
              title={detail(hero, catalogue)}
            >
              {troopClassInitial(hero.troop_class)}
            </span>
          ))}
        </span>
        {bonus !== null && (
          <span className="synergy">
            <strong>
              {bonus.count} {troopClassName(bonus.troopClass)}
            </strong>
            {/* The numbers, not just "has a bonus" — the whole point is
                comparing one opponent against another. */}
            <span>×{bonus.statMultiplier} atk/def</span>
            <span>+{Math.round(bonus.counterDamageBonus * 100)}% counter</span>
            {/* Both directions. A reader looking at someone else's defence
                wants the second one at least as much as the first. */}
            <span>
              beats {troopClassName(bonus.strongAgainst)} · loses to{' '}
              {troopClassName(bonus.weakAgainst)}
            </span>
          </span>
        )}
      </summary>
      {/* Rendered only while open: a Top100 board would otherwise build 100
          of these tables up front, for the one a reader actually opens. */}
      {open && (
        <table className="lineup-detail">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Hero</th>
              {/* Grade gets a column of its own rather than only tinting the
                  name: the word is what makes the colour legible, and it is
                  what a reader searching for "노랑" needs on the page.
                  The header is English like every other header here; only the
                  VALUES stay in the game's words, same rule as the labels. */}
              <th scope="col">Grade</th>
              <th scope="col">Class</th>
              <th scope="col">Lv</th>
              <th scope="col">★</th>
              {/* How far toward the next star. Worth a column of its own on
                  a defence board: it says who is about to get stronger. */}
              <th scope="col">Step</th>
              <th scope="col">Weapon</th>
              <th scope="col">Gear</th>
              <th scope="col">Skills</th>
              <th scope="col">Power</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((hero) => (
              <tr key={`${hero.slot}-${hero.hero_id}`}>
                <td className="num">{hero.slot ?? '—'}</td>
                {/* The id stays in the tooltip even when a name is shown:
                    it is what the payload carried and what a bug report
                    needs to name. */}
                <td className="label" title={`Hero ${hero.hero_id}`}>
                  {heroName(catalogue, hero.hero_id)}
                </td>
                <td
                  className={`grade-cell ${heroGradeClass(catalogue?.get(hero.hero_id)?.grade ?? null) ?? ''}`}
                >
                  {catalogue?.get(hero.hero_id)?.grade == null ? (
                    '—'
                  ) : (
                    <>
                      <span className="grade-dot" />
                      {heroGradeName(catalogue.get(hero.hero_id)?.grade ?? null)}
                    </>
                  )}
                </td>
                <td>{troopClassName(hero.troop_class)}</td>
                {/* Unqualified. A hero raised by the training centre really
                    is this level — the effect applies in combat — so marking
                    it would suggest the number is somehow provisional. */}
                <td className="num">{hero.hero_level ?? '—'}</td>
                {/* Converted, not raw: the payload counts one star higher
                    than the game, which caps at 5. See starsShown. */}
                <td className="num">{starsShown(hero.star) ?? '—'}</td>
                {/* The em dash here means "at maximum star, so there is no
                    next step" — not "unknown". A 0 would be a lie: below the
                    cap 0 is a real value meaning no progress yet. */}
                <td className="num" title={hero.stage === null ? 'At maximum star' : undefined}>
                  {hero.stage ?? '—'}
                </td>
                {/* Null is "not unlocked", a real state rather than a zero:
                    1,730 of 4,028 observed heroes have a weapon. */}
                <td className="num" title={weaponRankLabel(hero.weapon_level) ?? undefined}>
                  {hero.weapon_level === null
                    ? '—'
                    : `Lv ${hero.weapon_level} · ${weaponRankLabel(hero.weapon_level)}`}
                </td>
                <td className="num" title={hero.equipment.map((e) => e.equipment_id).join(', ')}>
                  {hero.equipment.length === 0
                    ? '—'
                    : hero.equipment.map((e) => e.level ?? '?').join(' / ')}
                </td>
                <td className="num" title={hero.skills.map((s) => s.skill_id).join(', ')}>
                  {hero.skills.length === 0
                    ? '—'
                    : hero.skills.map((s) => s.level ?? '?').join(' / ')}
                </td>
                <td className="num">
                  {hero.hero_power === null ? '—' : numberFormat.format(hero.hero_power)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
