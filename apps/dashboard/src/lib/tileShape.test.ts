import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from './tileShape';

const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return css.slice(start, css.indexOf('}', start));
};

describe('the tile shape', () => {
  it('is 4 wide and 3 tall', () => {
    expect([TILE_W, TILE_H]).toEqual([4, 3]);
  });
  it('is what the hive grid, which cannot import it, writes in CSS', () => {
    expect(block('.tile-grid')).toContain(`aspect-ratio: ${TILE_W} / ${TILE_H};`);
  });
  it('makes the atlas picture 4:3 per tile over its 3054 x 2554 world', () => {
    const frame = block('.atlas .map-frame');
    const [num, den] = /aspect-ratio: (\d+) \/ (\d+);/.exec(frame)?.slice(1).map(Number) ?? [];
    // Wc/Hc such that (3054/3164 Wc) : (2554/2664 Hc) is TILE_W : TILE_H.
    const want = ((TILE_W / TILE_H) * (2554 / 2664)) / (3054 / 3164);
    expect((num as number) / (den as number)).toBeCloseTo(want, 6);
  });
});
