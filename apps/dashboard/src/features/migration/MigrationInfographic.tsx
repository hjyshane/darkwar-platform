import { serverHash } from '../../lib/route';
import { TierBadge } from './TierBadge';
import {
  type BoardShift,
  type Route,
  type ServerFlow,
  type TierMobility,
  sankey,
  scale,
} from './analytics';
import { TIERS_TOP_DOWN } from './candidates';
import { num, power, signed, trend } from './format';

const WIDTH = 640;
const HEIGHT = 300;
const NODE = 56;
const LABEL = 40;

/** One tile per server: the net change as the headline, the two sides beneath it. The
 * tile's edge says gain or loss and the sign says it again. */
export function ServerScoreboard({ flows }: { flows: readonly ServerFlow[] }) {
  const ranked = [...flows].sort((a, b) => b.net - a.net || a.server - b.server);
  const max = Math.max(1, ...ranked.map((f) => Math.abs(f.net)));
  return (
    <ul className="info-tiles">
      {ranked.map((f) => (
        <li
          key={f.server}
          className={`info-tile ${f.net > 0 ? 'info-gain' : f.net < 0 ? 'info-loss' : ''}`}
          style={{ ['--info-weight' as string]: scale(f.net, max) }}
        >
          <a href={serverHash(f.server)} className="info-server">
            {f.server}
          </a>
          <strong className={`info-net ${trend(f.net)}`}>
            {f.net > 0 ? '▲ ' : f.net < 0 ? '▼ ' : ''}
            {signed(f.net)}
          </strong>
          <span className="info-sub">
            +{num(f.arrived)} in · −{num(f.left)} out
          </span>
          <span className={`info-sub ${trend(f.powerNet)}`}>{signed(f.powerNet, power)} power</span>
        </li>
      ))}
    </ul>
  );
}

/** Servers on the left as they started, servers on the right as they stand, a band per
 * route as thick as the number who took it. A band into a server that gained is teal. */
export function RouteFlow({
  routes,
  flows,
}: {
  routes: readonly Route[];
  flows: readonly ServerFlow[];
}) {
  const { left, right, links } = sankey(routes, HEIGHT);
  if (links.length === 0) return null;
  const gained = new Set(flows.filter((f) => f.net > 0).map((f) => f.server));
  const x0 = LABEL + NODE;
  const x1 = WIDTH - LABEL - NODE;
  const mid = (x0 + x1) / 2;
  return (
    <figure className="viz info-flow">
      <figcaption>
        Where they went — started on the left, stand on the right. Teal bands arrive at a server
        that gained players.
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Flow of movers from the server they started on to the server they stand on"
      >
        {links.map((l) => (
          <path
            key={`${l.from}>${l.to}`}
            d={`M${x0},${l.y0} C${mid},${l.y0} ${mid},${l.y1} ${x1},${l.y1}`}
            className={gained.has(l.to) ? 'info-band-gain' : 'info-band-loss'}
            strokeWidth={Math.max(1, l.h)}
            fill="none"
          >
            <title>{`${l.from} → ${l.to}: ${l.count}`}</title>
          </path>
        ))}
        {left.map((n) => (
          <g key={`l${n.server}`}>
            <rect
              x={LABEL}
              y={n.y}
              width={NODE - 8}
              height={Math.max(1, n.h)}
              className="info-node"
            />
            <text x={LABEL - 4} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle">
              {n.server}
            </text>
          </g>
        ))}
        {right.map((n) => (
          <g key={`r${n.server}`}>
            <rect
              x={WIDTH - LABEL - NODE + 8}
              y={n.y}
              width={NODE - 8}
              height={Math.max(1, n.h)}
              className="info-node"
            />
            <text
              x={WIDTH - LABEL + 4}
              y={n.y + n.h / 2}
              textAnchor="start"
              dominantBaseline="middle"
            >
              {n.server}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** The tiers stacked as a pyramid, narrowest at the top. Each step is as wide as the
 * tier is big; the filled part is the share of it that moved. Backbone has no size, so
 * its step is drawn full width and carries only the count. */
export function TierPyramid({ tiers }: { tiers: readonly TierMobility[] }) {
  return (
    <figure className="viz info-pyramid">
      <figcaption>Tiers by size — the filled part is who moved</figcaption>
      {TIERS_TOP_DOWN.map((t, i) => {
        const row = tiers.find((x) => x.tier === t);
        if (!row) return null;
        const width = 30 + (i * 70) / (TIERS_TOP_DOWN.length - 1);
        return (
          <div key={t} className="info-step" style={{ width: `${width}%` }}>
            <span className="info-step-fill" style={{ width: `${(row.share ?? 0) * 100}%` }} />
            <span className="info-step-text">
              <TierBadge tier={t} />
              <strong>{num(row.moved)}</strong>
              {row.share === null ? (
                <span className="subtle"> moved (seen)</span>
              ) : (
                <span className="subtle">
                  {' '}
                  of {num(row.size)} · {Math.round(row.share * 100)}%
                </span>
              )}
            </span>
          </div>
        );
      })}
    </figure>
  );
}

/** Top-226 seats before and after, one dumbbell per server: a dot where the server's
 * strongest players started and one where they stand now. */
export function SeatDumbbells({ shift }: { shift: readonly BoardShift[] }) {
  const max = Math.max(1, ...shift.flatMap((s) => [s.home, s.now]));
  return (
    <figure className="viz info-dumbbells">
      <figcaption>
        Top-226 seats per server — hollow: started there, filled: standing there
      </figcaption>
      <ul className="viz-rows">
        {shift.map((s) => (
          <li key={s.server}>
            <span className="viz-label">
              <a href={serverHash(s.server)}>{s.server}</a>
            </span>
            <span className="info-dumb" aria-hidden="true">
              <i
                className={`info-link ${s.net >= 0 ? 'viz-up' : 'viz-down'}`}
                style={{
                  left: `${(Math.min(s.home, s.now) / max) * 100}%`,
                  width: `${(Math.abs(s.net) / max) * 100}%`,
                }}
              />
              <b className="info-dot info-dot-from" style={{ left: `${(s.home / max) * 100}%` }} />
              <b className="info-dot info-dot-to" style={{ left: `${(s.now / max) * 100}%` }} />
            </span>
            <span className={`viz-text ${trend(s.net)}`}>
              {s.home} → {s.now} ({signed(s.net)})
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
