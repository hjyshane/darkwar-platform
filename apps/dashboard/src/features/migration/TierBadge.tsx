import { TIER_LABELS, type Tier } from './candidates';

/** The tier's word on its colour: backbone blue, elite orange, advanced purple,
 * commander red. The word stays, so colour is never the only carrier. */
export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier tier-${tier}`}>{TIER_LABELS[tier]}</span>;
}
