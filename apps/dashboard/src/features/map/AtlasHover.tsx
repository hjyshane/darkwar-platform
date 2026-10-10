import { formatCoordinate, toFraction } from '@dw/ui';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { type Atlas, allianceColor, formatPower, isShielded, shieldLeft } from './atlas';

/** The card that follows the pointer over a base: who, HQ, where, how strong,
 * and how long the shield has left.
 *
 * It listens on the plot from the outside, so the two thousand dots are not
 * re-rendered on every move. It sits in the plot at the base's own position and
 * keeps its size on screen like the other labels (the stylesheet divides by
 * `--map-zoom`).
 */
export function AtlasHover({ atlas, oursIndex }: { atlas: Atlas; oursIndex: number }) {
  const [uid, setUid] = useState<number | null>(null);
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const byUid = useMemo(() => new Map(atlas.bases.map((b) => [b.gameUid, b])), [atlas]);

  useEffect(() => {
    const plot = host?.parentElement;
    if (!plot) return;
    const read = (event: Event) => {
      const dot = (event.target as Element | null)?.closest?.('[data-uid]');
      const value = dot?.getAttribute('data-uid');
      setUid(value === null || value === undefined ? null : Number(value));
    };
    const leave = () => setUid(null);
    plot.addEventListener('pointerover', read);
    plot.addEventListener('pointerleave', leave);
    return () => {
      plot.removeEventListener('pointerover', read);
      plot.removeEventListener('pointerleave', leave);
    };
  }, [host]);

  const base = uid === null ? undefined : byUid.get(uid);
  const now = new Date();
  const alliance = base && base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
  const left =
    base && isShielded(base, now) && base.shieldEnd ? shieldLeft(base.shieldEnd, now) : null;
  const f = base ? toFraction(base.at) : null;
  const color = allianceColor(alliance?.id ?? null, !!base && base.alliance === oursIndex);

  return (
    <span aria-hidden="true" className="atlas-hover-host" ref={setHost}>
      {base && f && (
        <span
          className="atlas-hover"
          style={{ left: `${f.left * 100}%`, top: `${f.top * 100}%` } as CSSProperties}
        >
          <span className="atlas-hover__card">
            <strong className="atlas-hover__name">{base.name ?? 'unnamed'}</strong>
            <span className="atlas-hover__meta">
              <span className="atlas-hover__dot" style={{ background: color }} />
              {alliance?.code ? `[${alliance.code}] · ` : ''}
              {base.hq !== null && `HQ ${base.hq} · `}
              {formatCoordinate(base.at)}
            </span>
            <span className="atlas-hover__row">
              <span>Real power</span>
              <b>{formatPower(base.power)}</b>
            </span>
            <span className="atlas-hover__row">
              <span>Shield</span>
              <b className={left ? 'atlas-hover__shield' : undefined}>{left ?? 'No shield'}</b>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
