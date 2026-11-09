import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The calculator's stylesheet against the console rules a render test
 * cannot see: tokens only, no shadows or pills, and no rule that would
 * shadow a kit class or the arena's `.chip`. */
// vitest runs with cwd at apps/dashboard.
const root = join(process.cwd(), 'src');
const css = readFileSync(join(root, 'features', 'calculator', 'calculator.css'), 'utf8');
const tokens = readFileSync(join(root, 'index.css'), 'utf8');
// Comments may name a colour in words; rules may not.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('calculator.css', () => {
  it('uses no colour literal', () => {
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(rules.match(/\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/gi)).toBeNull();
  });

  it('names only tokens index.css declares', () => {
    const used = [...new Set([...rules.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? ''))];
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((name) => !tokens.includes(`${name}:`))).toEqual([]);
  });

  it('floats nothing on a shadow and rounds nothing into a pill', () => {
    expect(rules).not.toMatch(/box-shadow/);
    expect(rules).not.toMatch(/--radius-pill|--radius-lg|border-radius:\s*\d{2,}/);
  });

  it('keeps every selector in its own namespace', () => {
    const selectors = [...rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((m) =>
      (m[2] ?? '').split(',').map((s) => s.trim()),
    );
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter((s) => !s.startsWith('.calc'))).toEqual([]);
  });

  it('sets its labels in the console label face', () => {
    const label = rules.match(/\.calc-form \.field > label\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(label).toMatch(/font-family: var\(--font-mono\)/);
    expect(label).toMatch(/text-transform: uppercase/);
    expect(label).toMatch(/font-size: var\(--text-label\)/);
  });
});
