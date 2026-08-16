/** Deciding what to answer, once the request is known to be genuine.
 *
 * Split from `index.ts` so the interesting half can be tested without building
 * a signed HTTP request: this function takes a parsed interaction and returns a
 * response object, with no Worker, no crypto, and no network anywhere near it.
 *
 * Everything reaching here has already passed the signature check. That is a
 * precondition, not something this function re-verifies — but it is the reason
 * the code below can trust the body it was handed.
 */

import { COMMANDS } from './commands/registry.ts';
import {
  EPHEMERAL,
  type Interaction,
  type InteractionResponse,
  InteractionResponseType,
  InteractionType,
  optionValues,
} from './interaction.ts';
import { toEmbed } from './reply.ts';

/** Only the person who typed it sees this. An error belongs to them, not to
 *  the channel. */
function ephemeral(content: string): InteractionResponse {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  };
}

export function handleInteraction(interaction: Interaction): InteractionResponse {
  // Discord pings the endpoint to check it is alive — on save, and
  // periodically afterwards. Answering anything else here gets the endpoint
  // marked as broken and the commands stop appearing.
  if (interaction.type === InteractionType.PING) {
    return { type: InteractionResponseType.PONG };
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    // Buttons, modals, autocomplete. Nothing registers them yet, so an answer
    // would be a lie. Ephemeral, because a stray "not supported" in a channel
    // helps nobody.
    return ephemeral('That kind of interaction is not handled yet.');
  }

  const name = interaction.data?.name ?? '';
  const command = COMMANDS.get(name);

  // A command Discord still offers but the Worker no longer has — the shape of
  // every rename that got deployed before it got re-registered. Saying so is
  // more use than silence, which reads as the bot being down.
  if (command === undefined) {
    return ephemeral(`I do not have a command called "${name}" any more.`);
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [toEmbed(command.run(optionValues(interaction)))] },
  };
}
