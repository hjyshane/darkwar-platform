/** A rank as a hex medal: gold, silver, bronze for 1-3, plain for the rest.
 *
 * The number is always printed — colour is decoration, not the signal
 * (NFR-011). `null` renders a dash: an unranked row is unknown, not last. */
export function RankMedal({ rank }: { rank: number | null }) {
  if (rank === null) {
    return <span className="rank-medal">—</span>;
  }
  const tier = rank >= 1 && rank <= 3 ? ` rank-medal-${rank}` : '';
  return <span className={`rank-medal${tier}`}>{rank}</span>;
}
