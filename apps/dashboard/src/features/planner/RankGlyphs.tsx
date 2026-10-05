// Exclusive weapons and gear past level 100, drawn the way the game draws
// them instead of as a number nobody sees in game (user, 2026-10-04): five
// stars, each cut into five segments that fill one level at a time; then five
// pentagons — the awakening — cut and filled the same way.
//
// The arithmetic is lib/troops.ts's, confirmed in game there: a weapon fills
// one segment per level (level 22 = 4 stars and 2 segments; level 30 =
// awakening 1). Gear has no stars (user, 2026-10-05): its level runs 1 to
// 100, then the red pentagons fill. Promote 1-10 are the stage-ups the
// levelling passes through and draw nothing; from promote 11 each step is
// an awakening segment, 36 being five full pentagons (the largest value
// ever observed).

import { useId } from 'react';
import { useIcons } from '../../lib/gameIcons';
import { GEAR_PROMOTE_AT_MAX_LEVEL } from '../../lib/troops';

const SEGMENTS = 5;

function points(shape: 'star' | 'pentagon'): string {
  const out: string[] = [];
  const n = shape === 'star' ? 10 : 5;
  for (let i = 0; i < n; i += 1) {
    const r = shape === 'star' && i % 2 === 1 ? 4.2 : 10;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(' ');
}

/** One wedge of five, from the top, clockwise. */
function wedge(i: number): string {
  const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / SEGMENTS;
  const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / SEGMENTS;
  const p = (a: number) =>
    `${(12 + 13 * Math.cos(a)).toFixed(2)},${(12 + 13 * Math.sin(a)).toFixed(2)}`;
  return `M12,12 L${p(a0)} A13,13 0 0 1 ${p(a1)} Z`;
}

function Shape({ shape, filled }: { shape: 'star' | 'pentagon'; filled: number }) {
  const id = `rank-clip-${useId().replace(/:/g, '')}`;
  const outline = points(shape);
  // The game's own art when the reader has it (0233): the empty glyph,
  // already cut in five, with the full one shown through the filled wedges.
  const ui = useIcons('ui').data;
  const empty = ui?.get(`${shape}_empty`);
  const full = ui?.get(`${shape}_full`);
  if (empty && full) {
    return (
      <svg aria-hidden="true" className="rank-shape" height="20" viewBox="0 0 24 24" width="20">
        <clipPath id={id}>
          {Array.from({ length: Math.min(filled, SEGMENTS) }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: five fixed wedges
            <path d={wedge(i)} key={i} />
          ))}
        </clipPath>
        <image height="24" href={empty} width="24" />
        {filled > 0 && <image clipPath={`url(#${id})`} height="24" href={full} width="24" />}
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className={`rank-shape rank-${shape}`}
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <clipPath id={id}>
        <polygon points={outline} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed wedges
          <path className={i < filled ? 'rank-on' : 'rank-off'} d={wedge(i)} key={i} />
        ))}
      </g>
      <polygon className="rank-outline" points={outline} />
    </svg>
  );
}

/** `segments` filled across `count` shapes of five. */
function Row({
  shape,
  count,
  segments,
}: { shape: 'star' | 'pentagon'; count: number; segments: number }) {
  return (
    <span className="rank-row">
      {Array.from({ length: count }, (_, i) => (
        <Shape
          filled={Math.max(0, Math.min(SEGMENTS, segments - i * SEGMENTS))}
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          key={i}
          shape={shape}
        />
      ))}
    </span>
  );
}

/** Stars and pentagon segments of an exclusive weapon at a level. */
export function weaponSegments(level: number): { stars: number; awakening: number } {
  return { stars: Math.min(level, 25), awakening: Math.max(0, Math.min(level - 25, 25)) };
}

export function WeaponRank({ level }: { level: number }) {
  const { stars, awakening } = weaponSegments(level);
  return (
    <span className="rank" title={weaponText(level)}>
      {awakening > 0 ? (
        <Row count={5} segments={awakening} shape="pentagon" />
      ) : (
        <Row count={5} segments={stars} shape="star" />
      )}
    </span>
  );
}

/** Stage-up and awakening segments of gear past level 100. */
export function gearSegments(promote: number): { stage: number; awakening: number } {
  return {
    stage: Math.min(promote, 10),
    awakening: Math.max(0, Math.min(promote - GEAR_PROMOTE_AT_MAX_LEVEL, 25)),
  };
}

export function GearPromote({ promote }: { promote: number }) {
  const { awakening } = gearSegments(promote);
  return (
    <span className="rank" title={gearPromoteText(promote)}>
      <Row count={5} segments={awakening} shape="pentagon" />
    </span>
  );
}

/** For a dropdown, which can hold only text: "★4 ▰2" / "⬠1 ▰3". */
export function weaponText(level: number): string {
  const { stars, awakening } = weaponSegments(level);
  if (awakening > 0) {
    const full = Math.floor(awakening / SEGMENTS);
    const part = awakening % SEGMENTS;
    return `★5 ⬠${full}${part ? ` ▰${part}` : ''}`;
  }
  const full = Math.floor(stars / SEGMENTS);
  const part = stars % SEGMENTS;
  return `★${full}${part ? ` ▰${part}` : ''}`;
}

export function gearPromoteText(promote: number): string {
  const { stage, awakening } = gearSegments(promote);
  if (promote >= GEAR_PROMOTE_AT_MAX_LEVEL) {
    const full = Math.floor(awakening / SEGMENTS);
    const part = awakening % SEGMENTS;
    return `⬠${full}${part ? ` ▰${part}` : ''}`;
  }
  return stage === 0 ? '⬠0' : `⬠0 · stage ${stage}`;
}
