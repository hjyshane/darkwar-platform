import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The console primitives contract, read off the stylesheet and the markup.
 *
 * These are structural facts a render test cannot see (a sticky table head,
 * one `.chip` definition) but a page breaks visibly without. */
const root = process.cwd();
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('console primitives', () => {
  it('defines .chip once, for the arena lineup, and .filter-chip for filters', () => {
    expect(css.match(/^\.chip \{/gm)?.length).toBe(1);
    expect(css).toMatch(/^\.filter-chip \{/m);
  });

  it('has no filter call site left on .chip', () => {
    const offenders = walk(join(root, 'src'))
      .filter((p) => !/[\\/]arena[\\/]/.test(p))
      .filter((p) => /className="chip"/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('gives thead a sticky top on the top surface in the console label face', () => {
    const head = css.match(/^thead th \{([^}]*)\}/m)?.[1] ?? '';
    expect(head).toMatch(/background: var\(--bg-top\)/);
    expect(head).toMatch(/position: sticky/);
    expect(head).toMatch(/font-family: var\(--font-mono\)/);
  });

  it('collapses table borders and rules between columns', () => {
    expect(css).toMatch(/^table \{[^}]*border-collapse: collapse/m);
    expect(css).toMatch(/^th,\ntd \{[^}]*border-right: 1px solid var\(--border\)/m);
  });

  it('sets figures in tabular mono on stat tiles', () => {
    const value = css.match(/^\.stat-value \{([^}]*)\}/m)?.[1] ?? '';
    expect(value).toMatch(/font-family: var\(--font-mono\)/);
    expect(value).toMatch(/font-variant-numeric: tabular-nums/);
    const label = css.match(/^\.stat-label \{([^}]*)\}/m)?.[1] ?? '';
    expect(label).toMatch(/text-transform: uppercase/);
    expect(label).toMatch(/font-size: var\(--text-label\)/);
  });

  it('restyles the favourites chips under their renamed class', () => {
    expect(css).toMatch(/^\.chips \.filter-chip \{/m);
    expect(css).toMatch(/^\.chips button\.filter-chip \{/m);
    expect(css).not.toMatch(/^\.chips (button)?\.chip\b/m);
  });

  it('caps a fixed-column cell grid to wide viewports and lets cells shrink', () => {
    const kit = readFileSync(join(root, 'src', 'components', 'console', 'console.css'), 'utf8');
    const base = kit.match(/^\.cell-grid \{([^}]*)\}/m)?.[1] ?? '';
    expect(base).not.toMatch(/--cols/);
    expect(kit).toMatch(
      /@media \(min-width: 720px\) \{\s*\.cell-grid\[data-cols\] \{[^}]*repeat\(var\(--cols\), minmax\(0, 1fr\)\)/,
    );
  });

  it('gives bare links the accent instead of the browser default blue', () => {
    const anchor = css.match(/^a \{([^}]*)\}/m)?.[1] ?? '';
    expect(anchor).toMatch(/color: var\(--accent\)/);
  });

  it('lets a console cell value break instead of overflowing the grid', () => {
    const kit = readFileSync(join(root, 'src', 'components', 'console', 'console.css'), 'utf8');
    expect(kit).toMatch(/^\.cell-value \{[^}]*overflow-wrap: anywhere/m);
    expect(kit).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('fills the primary button with the accent fill and its own text colour', () => {
    const primary = css.match(/^button\.primary \{([^}]*)\}/m)?.[1] ?? '';
    expect(primary).toMatch(/background: var\(--accent-fill\)/);
    expect(primary).toMatch(/color: var\(--accent-fill-fg\)/);
    expect(primary).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
