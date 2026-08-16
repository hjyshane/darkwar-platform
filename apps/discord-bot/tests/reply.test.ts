/** The embed limits.
 *
 * These matter because Discord does not complain when they are exceeded — the
 * message just never appears, which from the channel is indistinguishable from
 * the bot being down. Every one of these assertions is a bug that would
 * otherwise be diagnosed as "the bot is broken".
 */

import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/commands/registry';
import { toEmbed } from '../src/reply';

describe('toEmbed', () => {
  it('leaves ordinary text alone', () => {
    expect(toEmbed({ title: 'Gear', body: '4 cores.' })).toEqual({
      title: 'Gear',
      description: '4 cores.',
    });
  });

  it('clamps a title to 256 characters', () => {
    const embed = toEmbed({ title: 'x'.repeat(400), body: '' });

    expect(embed.title).toHaveLength(256);
    expect(embed.title.endsWith('…')).toBe(true);
  });

  it('clamps a description to 4096 characters', () => {
    const embed = toEmbed({ title: 't', body: 'x'.repeat(5000) });

    // 4096 exactly, not 4097 — appending the ellipsis after slicing to the
    // limit is the off-by-one that puts it back over.
    expect(embed.description).toHaveLength(4096);
  });

  it('clamps a field value to 1024 characters', () => {
    const embed = toEmbed({
      title: 't',
      body: 'b',
      fields: [{ name: 'n', value: 'x'.repeat(2000) }],
    });

    expect(embed.fields?.[0]?.value).toHaveLength(1024);
  });

  it('keeps at most 25 fields', () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, value: 'v' }));

    expect(toEmbed({ title: 't', body: 'b', fields }).fields).toHaveLength(25);
  });

  it('replaces an empty field value, which Discord rejects outright', () => {
    // Easy to produce from a lookup table with a gap in it.
    const embed = toEmbed({ title: 't', body: 'b', fields: [{ name: 'n', value: '' }] });

    expect(embed.fields?.[0]?.value).toBe('—');
  });

  it('omits fields entirely rather than sending an empty array', () => {
    expect(toEmbed({ title: 't', body: 'b', fields: [] })).not.toHaveProperty('fields');
  });
});

describe('every registered command', () => {
  // Runs each command with no options — the bare `/command` case, which is
  // what somebody who does not know the options will type first.
  it.each([...COMMANDS.keys()])('produces an embed within the limits: /%s', (name) => {
    const command = COMMANDS.get(name);
    if (command === undefined) {
      throw new Error(`${name} vanished from the registry mid-test`);
    }

    const embed = toEmbed(command.run({}));

    expect(embed.title.length).toBeGreaterThan(0);
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(25);
  });
});
