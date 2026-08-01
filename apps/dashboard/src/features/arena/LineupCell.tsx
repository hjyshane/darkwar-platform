import {
  type LineupHero,
  bySlot,
  composition,
  troopClassInitial,
  troopClassName,
} from '../../lib/troops';

const numberFormat = new Intl.NumberFormat('ko-KR');

/** A defence lineup as five class chips in slot order.
 *
 * Chips rather than names because the protocol has no hero names — they are
 * client-side, and nothing in 1,984 captured observations carries one. What
 * it does carry is the class, which is the thing you counter, so that is what
 * the cell leads with. The hero id and its figures go in the tooltip for
 * anyone matching a specific hero.
 */
export function LineupCell({ heroes }: { heroes: readonly LineupHero[] }) {
  if (heroes.length === 0) {
    // Not a lineup of nobody — no `army` was decoded for this entry, which
    // is the same em dash every other unknown in these tables uses.
    return <>—</>;
  }
  return (
    <span className="lineup" title={composition(heroes)}>
      {bySlot(heroes).map((hero) => (
        <span
          className={`chip chip-class-${hero.troop_class ?? 'unknown'}`}
          key={`${hero.slot}-${hero.hero_id}`}
          title={[
            hero.slot === null ? 'Slot ?' : `Slot ${hero.slot}`,
            `Hero ${hero.hero_id}`,
            troopClassName(hero.troop_class),
            hero.star === null ? null : `${hero.star}★`,
            hero.hero_power === null ? null : numberFormat.format(hero.hero_power),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        >
          {troopClassInitial(hero.troop_class)}
        </span>
      ))}
    </span>
  );
}
