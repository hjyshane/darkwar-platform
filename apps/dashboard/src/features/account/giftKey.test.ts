import { describe, expect, test } from 'vitest';
import { extractGiftKey, pasteProblem } from './giftKey';

const sample = '3f2b8c1e-5a47-4d9e-8b6a-0c1d2e3f4a5b';
const other = '11111111-2222-4333-8444-555555555555';

describe('extractGiftKey', () => {
  test('takes a bare key, trimmed and lower-cased', () => {
    expect(extractGiftKey(`  ${sample.toUpperCase()} \n`)).toEqual({ ok: true, key: sample });
  });

  test('takes the uuid= of a pasted link', () => {
    const link = `https://giftcenter.example/code.php?uid=1135062125000580&code=ABC&uuid=${sample}&fromkoc=`;
    expect(extractGiftKey(link)).toEqual({ ok: true, key: sample });
  });

  test("a link's uuid= wins over another UUID in the text", () => {
    const link = `ref ${other} then ?uid=1&uuid=${sample}`;
    expect(extractGiftKey(link)).toEqual({ ok: true, key: sample });
  });

  test('the same key twice is still one key', () => {
    expect(extractGiftKey(`${sample} ${sample}`)).toEqual({ ok: true, key: sample });
  });

  test('two different keys with no uuid= is refused, not guessed', () => {
    expect(extractGiftKey(`${sample} ${other}`)).toEqual({ ok: false, reason: 'several' });
  });

  test('nothing usable is named for what it is', () => {
    expect(extractGiftKey('')).toEqual({ ok: false, reason: 'empty' });
    expect(extractGiftKey('1135062125000580')).toEqual({ ok: false, reason: 'none' });
    expect(pasteProblem({ ok: false, reason: 'none' })).toContain('No key found');
  });
});
