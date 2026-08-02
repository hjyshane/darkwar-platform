import { HERO_GRADES } from '../../lib/heroes';

/** What the marks on a lineup chip mean.
 *
 * A chip carries four things at once — fill, letter, ring, dot — and three of
 * them are shapes rather than words. That is the right trade inside a table
 * of a hundred rows and the wrong one if nothing ever says what they are, so
 * this sits above the table and says it once.
 *
 * Rendered from the same HERO_GRADES map the cells use, so a grade added
 * later cannot appear in the board and be missing from the key.
 */
export function LineupLegend() {
  return (
    <p className="lineup-legend">
      <span>
        {Object.entries(HERO_GRADES).map(([value, label]) => (
          <span key={value}>
            <span className={`grade-dot grade-${value}`} />
            {label}
          </span>
        ))}
      </span>
      <span>
        <span className="chip legend-chip chip-max-star" />
        테두리 = 5성
      </span>
      <span>
        <span className="chip legend-chip chip-weapon" />점 = 전용무기
      </span>
      <span>
        <span className="chip legend-chip chip-weapon chip-weapon-awakened" />
        빨간 점 = 무기 각
      </span>
      <span>
        <span className="chip legend-chip chip-synergy" />링 = 상성 보너스
      </span>
    </p>
  );
}
