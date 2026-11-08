import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The console token contract, checked against the stylesheet text.
 *
 * `index.css` declares its theme three times — light on `:root`, dark under
 * the media query, dark again under `[data-theme="dark"]` — and the chart
 * palette repeats the pattern lower down. The two dark halves have to say
 * the same thing or the header toggle and the OS preference drift apart,
 * which no render test would notice. So this reads the file and compares. */
// vitest runs with cwd at apps/dashboard; under jsdom `import.meta.url` is not a file URL.
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

/** Every `--token: value` declared under a selector, across all its blocks. */
function tokensOf(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().split('\n').pop()?.trim() !== selector) continue;
    for (const d of m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

const light = tokensOf(':root');
const darkMedia = tokensOf(':root:not([data-theme="light"])');
const darkAttr = tokensOf(':root[data-theme="dark"]');

describe('console tokens', () => {
  it('declares the same dark tokens under the media query and the attribute', () => {
    expect(Object.keys(darkAttr).length).toBeGreaterThan(20);
    expect(darkAttr).toEqual(darkMedia);
  });

  it('uses amber as the accent and the spec surfaces in dark', () => {
    expect(darkAttr['--accent']).toBe('#e0b452');
    expect(darkAttr['--accent-fg']).toBe('#15161a');
    expect(darkAttr['--accent-wash']).toBe('#2a2415');
    expect(darkAttr['--bg']).toBe('#15161a');
    expect(darkAttr['--bg-cell']).toBe('#1a1b20');
    expect(darkAttr['--bg-raised']).toBe('#1f2026');
    expect(darkAttr['--bg-top']).toBe('#121317');
    expect(darkAttr['--border']).toBe('#2c2e34');
    expect(darkAttr['--border-strong']).toBe('#3a3d45');
    expect(darkAttr['--fg-muted']).toBe('#8d8f96');
    expect(darkAttr['--ok']).toBe('#6cc38a');
    expect(darkAttr['--bad']).toBe('#e07070');
  });

  it('uses the paper grid and the dark gold accent in light', () => {
    expect(light['--accent']).toBe('#a16207');
    expect(light['--accent-fill']).toBe('#e0b452');
    expect(light['--bg']).toBe('#f4f3ef');
    expect(light['--bg-cell']).toBe('#ffffff');
    expect(light['--bg-raised']).toBe('#faf9f6');
    expect(light['--bg-top']).toBe('#ecebe6');
    expect(light['--border']).toBe('#d9d7cf');
    expect(light['--border-strong']).toBe('#bdbbb2');
  });

  it('aliases gold to the accent so one accent remains', () => {
    for (const t of [light, darkAttr]) {
      expect(t['--gold']).toBe('var(--accent)');
      expect(t['--gold-strong']).toBe('var(--accent)');
      expect(t['--gold-bg']).toBe('var(--accent-wash)');
    }
  });

  it('declares the label scale and a six-step data palette', () => {
    expect(light['--text-label']).toBe('0.625rem');
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(light[`--data-${n}`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkAttr[`--data-${n}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(darkAttr['--data-1']).toBe('#e0b452');
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(darkAttr[`--chart-${n}`]).toBe(`var(--data-${n})`);
    }
  });

  it('gives info its own cool neutral instead of navy', () => {
    expect(darkAttr['--info-bg']).toBe('#1e242c');
    expect(darkAttr['--info-fg']).toBe('#9fb0c3');
    expect(light['--info-bg']).toBe('#e6ebf1');
    expect(light['--info-fg']).toBe('#334155');
  });

  it('retires chrome blue and cyan everywhere except ink colours', () => {
    const stripped = css.replace(/--ink-[\w-]+:\s*[^;]+;/g, '');
    expect(stripped).not.toMatch(/#7aa2f7|#1d4ed8|#22d3ee|#35c6ff/i);
  });
});
