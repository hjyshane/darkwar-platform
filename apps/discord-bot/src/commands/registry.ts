/** Every command the bot knows.
 *
 * ADDING A COMMAND IS TWO LINES HERE AND ONE NEW FILE. That is the whole point
 * of the registry: the router, the signature check, and the deploy never have
 * to be touched again, and `scripts/register.ts` reads this same list, so a
 * command cannot exist in the Worker without also being offered in Discord.
 *
 * The map is keyed by the definition's own name rather than a string written
 * twice, because a registry whose key disagrees with the command it holds
 * produces a command that answers to a name Discord was never told about.
 */

import { gear } from './gear.ts';
import type { Command } from './types.ts';

/** The list. Append here; everything else follows. */
const ALL: readonly Command[] = [gear];

export const COMMANDS: ReadonlyMap<string, Command> = new Map(
  ALL.map((command) => [command.definition.name, command]),
);

/** What `scripts/register.ts` posts to Discord. */
export const DEFINITIONS = ALL.map((command) => command.definition);
