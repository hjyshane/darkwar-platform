import { describe, expect, it } from 'vitest';
import { type IntroSegment, namedServers, parseIntro } from './allies';

const KNOWN = [
  { allianceId: 'rbrn-565', serverId: 565, code: 'RBRN' },
  { allianceId: 'rbrn-570', serverId: 570, code: 'RBRN' },
  { allianceId: 'synn-570', serverId: 570, code: 'SYNN' },
  { allianceId: 'syn2-570', serverId: 570, code: 'SYN2' },
];

const allies = (line: IntroSegment[]) => line.filter((s) => s.kind === 'ally');
const rendered = (line: IntroSegment[]) =>
  line.map((s) => (s.kind === 'text' ? s.text : s.tag)).join('');

describe('parseIntro', () => {
  it('links every tag in a slash-separated line, unknown tags staying unlinked', () => {
    const line = '565 RBRN / 570 SYNN SYN2 RYSE';
    const [parsed] = parseIntro(line, KNOWN);
    expect(allies(parsed ?? [])).toEqual([
      { kind: 'ally', serverId: 565, tag: 'RBRN', allianceId: 'rbrn-565' },
      { kind: 'ally', serverId: 570, tag: 'SYNN', allianceId: 'synn-570' },
      { kind: 'ally', serverId: 570, tag: 'SYN2', allianceId: 'syn2-570' },
      { kind: 'ally', serverId: 570, tag: 'RYSE', allianceId: null },
    ]);
    expect(rendered(parsed ?? [])).toBe(line);
  });

  it('takes one group per line too', () => {
    const parsed = parseIntro('Allies:\n565 RBRN\n570 SYNN\n', KNOWN);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual([{ kind: 'text', text: 'Allies:' }]);
    expect(allies(parsed[1] ?? []).map((s) => s.allianceId)).toEqual(['rbrn-565']);
    expect(allies(parsed[2] ?? []).map((s) => s.allianceId)).toEqual(['synn-570']);
    expect(parsed[3]).toEqual([]);
  });

  it('leaves a line that is not entirely ally groups as text', () => {
    expect(parseIntro('We fight at 20 UTC every day', KNOWN)).toEqual([
      [{ kind: 'text', text: 'We fight at 20 UTC every day' }],
    ]);
    expect(parseIntro('565 RBRN are friends', KNOWN)).toEqual([
      [{ kind: 'text', text: '565 RBRN are friends' }],
    ]);
  });

  it('never matches across servers', () => {
    const [a, b] = parseIntro('565 RBRN\n571 SYNN', KNOWN);
    expect(allies(a ?? [])[0]?.allianceId).toBe('rbrn-565');
    expect(allies(b ?? [])[0]).toEqual({
      kind: 'ally',
      serverId: 571,
      tag: 'SYNN',
      allianceId: null,
    });
  });

  it('matches tags case-insensitively but keeps the text as written', () => {
    const [parsed] = parseIntro('570 synn', KNOWN);
    expect(allies(parsed ?? [])[0]).toEqual({
      kind: 'ally',
      serverId: 570,
      tag: 'synn',
      allianceId: 'synn-570',
    });
  });

  it('gives nothing for empty text', () => {
    expect(parseIntro('', KNOWN)).toEqual([]);
  });
});

describe('namedServers', () => {
  it('lists each server an ally group names, once, ascending', () => {
    expect(namedServers('571 ZBM / 565 RBRN\nhello\n565 XYZ')).toEqual([565, 571]);
  });
  it('is empty for text with no ally group', () => {
    expect(namedServers('We fight at 20 UTC')).toEqual([]);
  });
});
