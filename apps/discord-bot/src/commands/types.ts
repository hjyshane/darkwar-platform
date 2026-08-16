/** What a command is.
 *
 * A command is TWO THINGS THAT MUST AGREE: a definition Discord is told about
 * ahead of time (`scripts/register.ts` posts these), and a function that
 * answers when somebody runs it. Keeping them in one object is what stops the
 * usual drift where an option is added to the handler and never registered, so
 * Discord never offers it and the handler's branch is dead code nobody can
 * reach.
 *
 * `run` is deliberately synchronous and pure: options in, text out. Every
 * command here answers from a table compiled into the Worker, so there is
 * nothing to await — and a pure function is a command that can be tested
 * without a request, a network, or a mock.
 *
 * If a command ever needs to read Supabase, this is the signature that has to
 * change, and that is the moment to think about the three-second reply
 * deadline rather than before.
 */

import type { CommandReply } from '../reply.ts';

/** Discord's option types. Only the ones worth using here are named. */
export const OptionType = {
  STRING: 3,
  INTEGER: 4,
} as const;

export interface CommandOption {
  readonly name: string;
  readonly description: string;
  readonly type: number;
  readonly required?: boolean;
  /** A fixed set of answers, offered by Discord as a picker. Better than a
   *  free-text box whenever the real answer space is small and known. */
  readonly choices?: readonly { readonly name: string; readonly value: string | number }[];
}

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOption[];
}

export type CommandOptions = Record<string, string | number | boolean>;

export interface Command {
  readonly definition: CommandDefinition;
  run(options: CommandOptions): CommandReply;
}
