import { useState } from 'react';
import {
  type LineupHero,
  bySlot,
  composition,
  troopClassInitial,
  troopClassName,
} from '../../lib/troops';

const numberFormat = new Intl.NumberFormat('ko-KR');

function detail(hero: LineupHero): string {
  return [
    hero.slot === null ? 'Slot ?' : `Slot ${hero.slot}`,
    `Hero ${hero.hero_id}`,
    troopClassName(hero.troop_class),
    hero.hero_level === null ? null : `Lv ${hero.hero_level}`,
    hero.star === null ? null : `${hero.star}★`,
    hero.hero_power === null ? null : numberFormat.format(hero.hero_power),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** A defence lineup: five class chips, expanding to the detail behind them.
 *
 * Chips rather than hero names because the protocol has none — names are
 * client-side, and nothing in 1,984 captured observations carries one. What
 * it does carry is the class, which is what you counter, so the collapsed
 * cell leads with that.
 *
 * The expansion exists because the arena screen shows more than a roster:
 * level, star, the hero's exclusive weapon, four equipment pieces with their
 * own levels, and skill levels. All of that is decoded, and collapsing it to
 * five letters would throw away the reason for decoding it.
 */
export function LineupCell({ heroes }: { heroes: readonly LineupHero[] }) {
  const [open, setOpen] = useState(false);

  if (heroes.length === 0) {
    // Not a lineup of nobody — no `army` was decoded for this entry, which is
    // the same em dash every other unknown in these tables uses.
    return <>—</>;
  }
  const ordered = bySlot(heroes);
  return (
    <details className="lineup-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="lineup" title={composition(heroes)}>
          {ordered.map((hero) => (
            <span
              className={`chip chip-class-${hero.troop_class ?? 'unknown'}`}
              key={`${hero.slot}-${hero.hero_id}`}
              title={detail(hero)}
            >
              {troopClassInitial(hero.troop_class)}
            </span>
          ))}
        </span>
      </summary>
      {/* Rendered only while open: a Top100 board would otherwise build 100
          of these tables up front, for the one a reader actually opens. */}
      {open && (
        <table className="lineup-detail">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Hero</th>
              <th scope="col">Class</th>
              <th scope="col">Lv</th>
              <th scope="col">★</th>
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
                <td className="num">{hero.hero_id}</td>
                <td>{troopClassName(hero.troop_class)}</td>
                <td className="num">{hero.hero_level ?? '—'}</td>
                <td className="num">{hero.star ?? '—'}</td>
                {/* Null is "not unlocked", a real state rather than a zero:
                    1,730 of 4,028 observed heroes have a weapon. */}
                <td className="num">
                  {hero.weapon_level === null ? '—' : `Lv ${hero.weapon_level}`}
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
