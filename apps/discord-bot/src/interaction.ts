/** The shapes Discord sends and expects back.
 *
 * Hand-written rather than pulled from `discord-api-types`, because the bot
 * touches four of that package's several hundred types and a dependency whose
 * major versions track Discord's API churn is a poor trade for four
 * interfaces. If the bot ever grows components or modals, revisit.
 */

/** Discord's interaction types. Only the two the bot answers are named. */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

/** Discord's response types. */
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
} as const;

/** Only the sender sees the message. Used for "no such command" and for
 *  anything that would be noise in a busy channel. */
export const EPHEMERAL = 1 << 6;

export interface CommandOptionValue {
  readonly name: string;
  readonly value?: string | number | boolean;
}

export interface Interaction {
  readonly type: number;
  readonly data?: {
    readonly name?: string;
    readonly options?: readonly CommandOptionValue[];
  };
}

export interface Embed {
  readonly title: string;
  readonly description: string;
  readonly fields?: readonly { readonly name: string; readonly value: string }[];
}

export interface InteractionResponse {
  readonly type: number;
  readonly data?: {
    readonly embeds?: readonly Embed[];
    readonly content?: string;
    readonly flags?: number;
  };
}

/** Is this parsed body actually an interaction?
 *
 * The signature already proved Discord sent it, so this is not a security
 * check — it is a "the API changed under us" check, and the reason the router
 * can treat `type` as a number without a cast.
 */
export function isInteraction(value: unknown): value is Interaction {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'number'
  );
}

/** The options Discord sent, flattened to a plain lookup.
 *
 * Commands get `{ level: 12 }` rather than walking an array of
 * `{ name, value }` objects, because every command would otherwise write the
 * same three lines of searching.
 */
export function optionValues(interaction: Interaction): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const option of interaction.data?.options ?? []) {
    if (option.value !== undefined) {
      out[option.name] = option.value;
    }
  }
  return out;
}
