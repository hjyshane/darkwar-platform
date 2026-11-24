import { describe, expect, it } from 'vitest';
import { de } from './catalogs/de';
import { es } from './catalogs/es';
import { fr } from './catalogs/fr';
import { it as italian } from './catalogs/it';
import { ko } from './catalogs/ko';
import { tr } from './catalogs/tr';
import { vi } from './catalogs/vi';
import { zh } from './catalogs/zh';
import { type Catalog, english, fill, pickLanguage, placeholders, translator } from './core';
import { NAMES, dynamicKeys } from './keys';

/** Every literal `t('…')` in the app's source (tests and the dev build aside). */
function literalKeys(): Set<string> {
  const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.*', '!../../dev/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const keys = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      keys.add((match[2] as string).replace(/\\(['"])/g, '$1'));
    }
  }
  return keys;
}

const REQUIRED = new Set([...literalKeys(), ...dynamicKeys()].filter((key) => !NAMES.has(key)));

const CATALOGS: Record<string, Catalog> = { ko, fr, tr, it: italian, es, de, zh, vi };

describe('the catalogues', () => {
  it('find the strings the app translates', () => {
    // A sanity floor: if the scan broke, every catalogue would pass vacuously.
    expect(REQUIRED.size).toBeGreaterThan(150);
    expect(REQUIRED.has('Sign out')).toBe(true);
    expect(REQUIRED.has('Last ranking')).toBe(true);
  });

  for (const [code, catalog] of Object.entries(CATALOGS)) {
    describe(code, () => {
      it('translates every string the app passes to t()', () => {
        const missing = [...REQUIRED].filter((key) => !(key in catalog)).sort();
        expect(missing).toEqual([]);
      });

      it('carries no string the app no longer uses', () => {
        const stale = Object.keys(catalog)
          .filter((key) => !REQUIRED.has(key) && !NAMES.has(key))
          .sort();
        expect(stale).toEqual([]);
      });

      it('keeps every placeholder, and adds none', () => {
        const wrong = Object.entries(catalog)
          .filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
          .map(([key]) => key);
        expect(wrong).toEqual([]);
      });

      it('leaves no translation empty', () => {
        expect(Object.entries(catalog).filter(([, value]) => value.trim() === '')).toEqual([]);
      });
    });
  }
});

describe('translate', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(fill('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
    expect(fill('{a} of {b}', { a: 1 })).toBe('1 of {b}');
    expect(english('Sign out')).toBe('Sign out');
    expect(translator({ 'Sign out': '로그아웃' })('Sign out')).toBe('로그아웃');
    // Not in the catalogue: English, never a blank.
    expect(translator({})('Sign out')).toBe('Sign out');
  });

  it('picks the stored choice, then the browser, then the site default', () => {
    expect(pickLanguage('de', ['ko-KR'], 'en')).toBe('de');
    expect(pickLanguage(null, ['xx', 'ko-KR', 'en'], 'en')).toBe('ko');
    expect(pickLanguage(null, ['zh-TW'], 'en')).toBe('zh');
    expect(pickLanguage('nonsense', ['pt-BR'], 'vi')).toBe('vi');
  });
});
