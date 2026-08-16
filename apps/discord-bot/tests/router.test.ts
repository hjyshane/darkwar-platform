import { describe, expect, it } from 'vitest';
import { COMMANDS, DEFINITIONS } from '../src/commands/registry';
import {
  EPHEMERAL,
  InteractionResponseType,
  InteractionType,
  isInteraction,
  optionValues,
} from '../src/interaction';
import { handleInteraction } from '../src/router';

describe('handleInteraction', () => {
  it('answers a PING with a PONG', () => {
    // Discord sends this when the endpoint URL is saved and periodically
    // after. Anything else and the endpoint is marked broken.
    expect(handleInteraction({ type: InteractionType.PING })).toEqual({
      type: InteractionResponseType.PONG,
    });
  });

  it('runs a registered command and returns an embed', () => {
    const response = handleInteraction({
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: 'gear' },
    });

    expect(response.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(response.data?.embeds).toHaveLength(1);
  });

  it('passes options through to the command', () => {
    const all = handleInteraction({
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: 'gear' },
    });
    const one = handleInteraction({
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: 'gear', options: [{ name: 'tier', value: 'blue' }] },
    });

    // Not a value assertion — the placeholder table will be replaced. What
    // matters is that an option reaches `run` and changes the answer, which is
    // the wiring that silently breaks.
    expect(one.data?.embeds?.[0]?.title).not.toBe(all.data?.embeds?.[0]?.title);
  });

  it('says so, quietly, when the command is no longer in the Worker', () => {
    // The shape of every rename deployed before it was re-registered.
    const response = handleInteraction({
      type: InteractionType.APPLICATION_COMMAND,
      data: { name: 'nosuchcommand' },
    });

    expect(response.data?.content).toContain('nosuchcommand');
    expect(response.data?.flags).toBe(EPHEMERAL);
  });

  it('does not pretend to handle buttons or modals', () => {
    const response = handleInteraction({ type: 3 });

    expect(response.data?.flags).toBe(EPHEMERAL);
    expect(response.data?.embeds).toBeUndefined();
  });
});

describe('optionValues', () => {
  it('flattens Discord option arrays to a lookup', () => {
    expect(
      optionValues({
        type: InteractionType.APPLICATION_COMMAND,
        data: {
          options: [
            { name: 'tier', value: 'gold' },
            { name: 'level', value: 12 },
          ],
        },
      }),
    ).toEqual({ tier: 'gold', level: 12 });
  });

  it('drops options Discord sent with no value', () => {
    // A subcommand group arrives shaped like an option but carries no value;
    // letting `undefined` into the lookup would make `options.tier !== undefined`
    // lie to every command that checks it.
    expect(
      optionValues({
        type: InteractionType.APPLICATION_COMMAND,
        data: { options: [{ name: 'tier' }] },
      }),
    ).toEqual({});
  });

  it('is empty when the command took no options', () => {
    expect(optionValues({ type: InteractionType.APPLICATION_COMMAND })).toEqual({});
  });
});

describe('isInteraction', () => {
  it.each([
    ['null', null],
    ['a string', 'ping'],
    ['an object with no type', { data: {} }],
    ['a type that is not a number', { type: '1' }],
  ])('rejects %s', (_label, value) => {
    expect(isInteraction(value)).toBe(false);
  });

  it('accepts a real interaction', () => {
    expect(isInteraction({ type: 1 })).toBe(true);
  });
});

describe('the registry', () => {
  it('keys every command by its own declared name', () => {
    // A key that disagrees with the command it holds answers to a name Discord
    // was never told about.
    for (const [key, command] of COMMANDS) {
      expect(key).toBe(command.definition.name);
    }
  });

  it('registers exactly what it can run', () => {
    // `scripts/register.ts` posts DEFINITIONS; the router dispatches through
    // COMMANDS. If they drift, Discord offers a command that answers nothing.
    expect(DEFINITIONS.map((d) => d.name).sort()).toEqual([...COMMANDS.keys()].sort());
  });

  it('gives every command a description Discord will accept', () => {
    // Discord rejects the whole PUT for one empty description, and the error
    // names a field index rather than a command.
    for (const definition of DEFINITIONS) {
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeLessThanOrEqual(100);
      expect(definition.name).toMatch(/^[a-z0-9_-]{1,32}$/);
    }
  });
});
