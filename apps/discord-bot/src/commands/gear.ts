/** `/gear` — what a gear upgrade costs.
 *
 * ⚠️ THE NUMBERS BELOW ARE PLACEHOLDERS AND ARE NOT THE REAL GAME VALUES. ⚠️
 *
 * This command exists to fix the SHAPE the real commands will take, not to be
 * right. Nobody has supplied the real core costs yet, and a wrong table shipped
 * confidently is worse than no table — somebody spends a week's cores on a
 * number a bot made up.
 *
 * Replace `COST_BY_TIER` with the real figures and delete this warning. The
 * test beside it deliberately pins the SHAPE (every tier present, no negative
 * counts, output within Discord's limits) and NOT the values, so filling in the
 * real numbers does not turn the suite red.
 *
 * THE PATTERN FOR EVERY LATER COMMAND IS THIS FILE:
 *
 *   1. a plain table, `as const`, at the top — the knowledge, in one place
 *   2. a `definition` naming the command and its options
 *   3. a `run` that looks the answer up and returns text
 *
 * No fetching, no formatting of embeds, no Discord vocabulary. The router
 * handles the interaction and `reply.ts` handles the limits.
 */

import type { CommandReply } from '../reply.ts';
import { type Command, type CommandOptions, OptionType } from './types.ts';

/** Cores per upgrade, by gear tier. PLACEHOLDER DATA — see the note above. */
const COST_BY_TIER = {
  green: { cores: 4, note: 'Cheapest tier; worth finishing before touching blue.' },
  blue: { cores: 12, note: 'The usual wall for a new account.' },
  purple: { cores: 40, note: 'Do one piece at a time.' },
  gold: { cores: 120, note: 'Save cores rather than spreading them thin.' },
} as const;

type Tier = keyof typeof COST_BY_TIER;

const TIERS = Object.keys(COST_BY_TIER) as readonly Tier[];

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && value in COST_BY_TIER;
}

export const gear: Command = {
  definition: {
    name: 'gear',
    description: 'Cores needed to upgrade a piece of gear',
    options: [
      {
        name: 'tier',
        description: 'Which tier of gear (leave empty for the whole table)',
        type: OptionType.STRING,
        // Offered as a picker. A free-text box here would mean handling
        // "Purple", "purple ", and "purpel" — none of which are interesting
        // problems when the answer space is four fixed words.
        choices: TIERS.map((tier) => ({ name: tier, value: tier })),
      },
    ],
  },

  run(options: CommandOptions): CommandReply {
    const tier = options.tier;

    // No tier asked for: the whole table, which is what somebody typing the
    // command with no idea what the tiers are called actually wants.
    if (tier === undefined) {
      return {
        title: 'Gear upgrade cost',
        body: 'Cores needed per upgrade.',
        fields: TIERS.map((name) => ({
          name,
          value: `**${COST_BY_TIER[name].cores}** cores — ${COST_BY_TIER[name].note}`,
        })),
      };
    }

    // Discord validates choices, so this branch should be unreachable in
    // practice. It is here because "should be unreachable" and "is
    // unreachable" differ by one stale registration.
    if (!isTier(tier)) {
      return {
        title: 'Gear upgrade cost',
        body: `I do not know the tier "${String(tier)}". Known tiers: ${TIERS.join(', ')}.`,
      };
    }

    const cost = COST_BY_TIER[tier];
    return {
      title: `Gear upgrade cost — ${tier}`,
      body: `**${cost.cores}** cores per upgrade.\n\n${cost.note}`,
    };
  },
};
