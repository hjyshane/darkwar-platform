// The shape of one coordinate cell, as the game draws it: wider than tall,
// 4 to 3 (owner, 2026-11-20). One place, so the hive grid, the base-placement
// tester and the map picture cannot disagree.
//
// Only DRAWING cares. Coordinates, tiles-across and every rule are counted in
// cells and never in pixels, so nothing outside a renderer reads these.
//
// CSS cannot import this: `.tile-grid` in index.css writes `4 / 3` by hand and
// points here. Change them together.

export const TILE_W = 4;
export const TILE_H = 3;
