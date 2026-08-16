/** Turning a command's answer into something Discord will actually render.
 *
 * DISCORD SILENTLY REFUSES AN OVERSIZED EMBED. It does not truncate and it does
 * not explain; the message simply never appears, which from the channel looks
 * exactly like the bot being down. `services/collector/.../notify/compose.py`
 * learned this for the webhook path and clamps there too — the limits below are
 * the same numbers, restated because the two live in different languages and
 * neither can import the other.
 *
 * Commands return plain text and this is the only place that knows the limits,
 * so a new command cannot forget them.
 */

import type { Embed } from './interaction.ts';

/** Discord's own caps. */
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FIELD_NAME_LIMIT = 256;
const FIELD_VALUE_LIMIT = 1024;
const FIELD_COUNT_LIMIT = 25;

/** What a command hands back. Text and structure, no Discord vocabulary —
 *  a command should not have to know what an embed is. */
export interface CommandReply {
  readonly title: string;
  readonly body: string;
  readonly fields?: readonly { readonly name: string; readonly value: string }[];
}

/** Cut to `limit`, marking the cut so a reader knows something is missing.
 *
 * The ellipsis is inside the budget, not added to it — appending it after
 * slicing to the limit is how you produce a string one character over and go
 * straight back to the silent-refusal case this function exists to prevent.
 */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
}

export function toEmbed(reply: CommandReply): Embed {
  const fields = (reply.fields ?? []).slice(0, FIELD_COUNT_LIMIT).map((field) => ({
    name: clamp(field.name, FIELD_NAME_LIMIT),
    // A field Discord will reject outright if it is empty, which is easy to
    // produce from a lookup table with a gap in it.
    value: clamp(field.value === '' ? '—' : field.value, FIELD_VALUE_LIMIT),
  }));

  return {
    title: clamp(reply.title, TITLE_LIMIT),
    description: clamp(reply.body, DESCRIPTION_LIMIT),
    ...(fields.length > 0 ? { fields } : {}),
  };
}
