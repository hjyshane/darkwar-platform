import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The copycat test, for the part of it a stylesheet can fail: the header
 * takes every colour from a token, floats nothing on a shadow and rounds
 * nothing into a pill. Read off the file, as `styles/tokens.test.ts` does
 * for `index.css`. */
// vitest runs with cwd at apps/dashboard.
const css = readFileSync(
  join(process.cwd(), 'src', 'features', 'player', 'profileHeader.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('profileHeader.css', () => {
  it('has rules to check', () => {
    expect(css).toMatch(/\.profile-identity {/);
  });

  it('uses tokens for every colour', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(css.match(/\b(rgb|rgba|hsl|hsla|oklch)\(/gi) ?? []).toEqual([]);
  });

  it('draws no shadow and no glow', () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|filter:/);
  });

  it('rounds nothing beyond the small radius', () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(radii.filter((value) => value !== 'var(--radius-md)' && value !== '0')).toEqual([]);
  });

  it('sets its labels in the mono uppercase label face', () => {
    const label = css.match(/\.profile-label \{([^}]*)\}/)?.[1] ?? '';
    expect(label).toMatch(/font-family: var\(--font-mono\)/);
    expect(label).toMatch(/font-size: var\(--text-label\)/);
    expect(label).toMatch(/text-transform: uppercase/);
  });
});
