// Base placement tester: put 3x3 bases around a structure and see whether the
// territory it claims is left with room for another one.
//
// Nothing here is read from or written to the database. The state is local to
// the browser (a per-viewer convenience, kept in localStorage when it works),
// and the rules are in placement.ts.

import { useMemo, useState } from 'react';
import './basePlacement.css';
import {
  BASE_SIZE,
  type Cell,
  type Structure,
  TRADE_SHOP,
  areaRect,
  baseRect,
  coordinateList,
  footprintRect,
  openSlots,
  packedExtra,
  refusal,
  refusalText,
  ringFor,
  validSide,
} from './placement';

const STORE_KEY = 'dw.basePlacement.v1';
const MARGIN = 3;

interface State {
  structures: Structure[];
  bases: Cell[];
}

const DEFAULT_STATE: State = {
  structures: [{ id: 's1', name: 'Trade Shop', x: 377, y: 436, ...TRADE_SHOP }],
  bases: [],
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What a browser gave back, or the default when it is missing, damaged or
 * from a version that wrote something else. */
export function parseState(raw: string | null): State {
  if (raw === null) return DEFAULT_STATE;
  try {
    const data = JSON.parse(raw) as { structures?: unknown; bases?: unknown };
    if (!Array.isArray(data.structures) || !Array.isArray(data.bases)) return DEFAULT_STATE;
    const structures: Structure[] = [];
    for (const s of data.structures as Record<string, unknown>[]) {
      if (
        typeof s.id !== 'string' ||
        typeof s.name !== 'string' ||
        !isNum(s.x) ||
        !isNum(s.y) ||
        !isNum(s.footprint) ||
        !validSide(s.footprint) ||
        !(s.area === null || (isNum(s.area) && validSide(s.area)))
      ) {
        return DEFAULT_STATE;
      }
      structures.push({
        id: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        footprint: s.footprint,
        area: s.area,
      });
    }
    const bases: Cell[] = [];
    for (const b of data.bases as Record<string, unknown>[]) {
      if (!isNum(b.x) || !isNum(b.y)) return DEFAULT_STATE;
      bases.push({ x: b.x, y: b.y });
    }
    return { structures, bases };
  } catch {
    return DEFAULT_STATE;
  }
}

function load(): State {
  try {
    return parseState(window.localStorage.getItem(STORE_KEY));
  } catch {
    return DEFAULT_STATE;
  }
}

function save(state: State) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private window or blocked storage: the page works, it just forgets.
  }
}

function bounds(state: State) {
  const rects = [
    ...state.structures.flatMap((s) => [footprintRect(s), areaRect(s)]),
    ...state.bases.map(baseRect),
  ].filter((r) => r !== null);
  if (rects.length === 0) return { x0: -10, y0: -10, x1: 10, y1: 10 };
  return {
    x0: Math.min(...rects.map((r) => r.x0)) - MARGIN,
    y0: Math.min(...rects.map((r) => r.y0)) - MARGIN,
    x1: Math.max(...rects.map((r) => r.x1)) + MARGIN,
    y1: Math.max(...rects.map((r) => r.y1)) + MARGIN,
  };
}

let nextId = 1;
const newId = () => `s${Date.now().toString(36)}${nextId++}`;

function toInt(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function BasePlacementPage() {
  const [state, setState] = useState<State>(load);
  const [hover, setHover] = useState<Cell | null>(null);
  const [typed, setTyped] = useState({ x: '', y: '' });
  const [said, setSaid] = useState<string | null>(null);

  const update = (next: State) => {
    setState(next);
    save(next);
    setSaid(null);
  };

  const { structures, bases } = state;
  const open = useMemo(() => openSlots(bases, structures), [bases, structures]);
  const extra = useMemo(() => packedExtra(bases, structures), [bases, structures]);
  const view = bounds(state);
  const width = view.x1 - view.x0 + 1;
  const height = view.y1 - view.y0 + 1;
  const hasArea = structures.some((s) => s.area !== null);
  const sealed = hasArea && open.length === 0;
  const ring = structures.map(ringFor).find((r) => r !== null) ?? null;

  // Any of a base's nine tiles picks it up, not only its centre.
  const baseIndexAt = (cell: Cell) =>
    bases.findIndex((b) => {
      const r = baseRect(b);
      return cell.x >= r.x0 && cell.x <= r.x1 && cell.y >= r.y0 && cell.y <= r.y1;
    });

  const place = (at: Cell) => {
    const hit = baseIndexAt(at);
    if (hit >= 0) {
      update({ ...state, bases: bases.filter((_, i) => i !== hit) });
      return;
    }
    if (refusal(at, bases, structures) === null) update({ ...state, bases: [...bases, at] });
  };

  const cellAt = (event: React.MouseEvent<SVGSVGElement>): Cell => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: view.x0 + Math.floor(((event.clientX - box.left) / box.width) * width),
      y: view.y0 + Math.floor(((event.clientY - box.top) / box.height) * height),
    };
  };

  // Clicking a base removes it, so the ghost on one says "remove", not a refusal.
  const ghost = hover;
  const ghostOnBase = ghost !== null && baseIndexAt(ghost) >= 0;
  const ghostRefusal = ghost !== null && !ghostOnBase ? refusal(ghost, bases, structures) : null;

  const typedAt: Cell | null =
    typed.x.trim() !== '' && typed.y.trim() !== ''
      ? { x: toInt(typed.x, Number.NaN), y: toInt(typed.y, Number.NaN) }
      : null;
  const typedValid = typedAt !== null && Number.isFinite(typedAt.x) && Number.isFinite(typedAt.y);
  const typedRefusal = typedValid && typedAt !== null ? refusal(typedAt, bases, structures) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coordinateList(bases));
      setSaid('Copied');
    } catch {
      setSaid('Select the list below and copy it');
    }
  };

  const editStructure = (id: string, patch: Partial<Structure>) =>
    update({
      ...state,
      structures: structures.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });

  return (
    <main>
      <section>
        <h2>Merchant tester</h2>
        <p className="bp-intro">
          Place 3x3 bases around a structure and check whether anyone else can still place one
          inside its territory. Bases cannot overlap each other or a structure's footprint; they can
          stand inside a territory, and structures can overlap each other. Nothing is saved to the
          server.
        </p>
      </section>
      <div className="bp">
        <div className="bp-board">
          <svg
            aria-label="Placement grid. Click an empty tile to place a base, a base to remove it."
            className="bp-svg"
            onClick={(event) => place(cellAt(event))}
            onKeyDown={undefined}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => setHover(cellAt(event))}
            role="img"
            viewBox={`${view.x0} ${view.y0} ${width} ${height}`}
          >
            <title>Placement grid</title>
            {Array.from({ length: width + 1 }, (_, i) => (
              <line
                className="bp-grid"
                key={`v${view.x0 + i}`}
                x1={view.x0 + i}
                x2={view.x0 + i}
                y1={view.y0}
                y2={view.y1 + 1}
              />
            ))}
            {Array.from({ length: height + 1 }, (_, i) => (
              <line
                className="bp-grid"
                key={`h${view.y0 + i}`}
                x1={view.x0}
                x2={view.x1 + 1}
                y1={view.y0 + i}
                y2={view.y0 + i}
              />
            ))}
            {structures.map((s) => {
              const area = areaRect(s);
              return area === null ? null : (
                <rect
                  className="bp-area"
                  height={area.y1 - area.y0 + 1}
                  key={`a${s.id}`}
                  width={area.x1 - area.x0 + 1}
                  x={area.x0}
                  y={area.y0}
                />
              );
            })}
            {open.map((c) => (
              <circle
                className="bp-open"
                cx={c.x + 0.5}
                cy={c.y + 0.5}
                key={`o${c.x},${c.y}`}
                r={0.18}
              />
            ))}
            {structures.map((s) => {
              const f = footprintRect(s);
              return (
                <rect
                  className="bp-footprint"
                  height={f.y1 - f.y0 + 1}
                  key={`f${s.id}`}
                  width={f.x1 - f.x0 + 1}
                  x={f.x0}
                  y={f.y0}
                />
              );
            })}
            {bases.map((b) => {
              const r = baseRect(b);
              return (
                <rect
                  className="bp-base"
                  height={BASE_SIZE}
                  key={`b${b.x},${b.y}`}
                  width={BASE_SIZE}
                  x={r.x0}
                  y={r.y0}
                />
              );
            })}
            {ghost !== null && (
              <rect
                className={
                  ghostOnBase
                    ? 'bp-ghost bp-ghost-remove'
                    : ghostRefusal
                      ? 'bp-ghost bp-ghost-no'
                      : 'bp-ghost'
                }
                height={BASE_SIZE}
                width={BASE_SIZE}
                x={baseRect(ghost).x0}
                y={baseRect(ghost).y0}
              />
            )}
          </svg>
          <p className="bp-hint">
            {ghost === null
              ? 'Hover a tile to see where a base would stand.'
              : `${ghost.x}, ${ghost.y} — ${
                  ghostOnBase
                    ? 'click to remove this base'
                    : ghostRefusal
                      ? refusalText(ghostRefusal)
                      : 'click to place a base'
                }`}
          </p>
        </div>

        <div className="bp-side">
          <div className={sealed ? 'bp-verdict bp-sealed' : 'bp-verdict'}>
            {!hasArea ? (
              <strong>No structure has a territory to check.</strong>
            ) : sealed ? (
              <strong>Sealed: no other base fits inside the territory.</strong>
            ) : (
              <>
                <strong>Not sealed.</strong> {open.length} spots left for a base to stand
                {extra > 0 && `; at least ${extra} more could be placed`}. They are the dots on the
                grid.
              </>
            )}
            <div className="bp-count">
              {bases.length} base{bases.length === 1 ? '' : 's'} placed
            </div>
          </div>

          <div className="bp-actions">
            <button
              disabled={ring === null}
              onClick={() => ring !== null && update({ ...state, bases: ring })}
              title={
                ring === null
                  ? 'The sealing ring is only known for a 5x5 structure with a 17x17 territory'
                  : 'Replace the bases with the eight-base ring that seals the Trade Shop'
              }
              type="button"
            >
              Place the sealing ring
            </button>
            <button
              disabled={bases.length === 0}
              onClick={() => update({ ...state, bases: [] })}
              type="button"
            >
              Clear bases
            </button>
            <button disabled={bases.length === 0} onClick={copy} type="button">
              Copy coordinates
            </button>
            {said !== null && <output className="bp-said">{said}</output>}
          </div>

          <form
            className="bp-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (typedAt !== null && typedValid && typedRefusal === null) {
                update({ ...state, bases: [...bases, typedAt] });
                setTyped({ x: '', y: '' });
              }
            }}
          >
            <label>
              Base x
              <input
                inputMode="numeric"
                onChange={(event) => setTyped({ ...typed, x: event.target.value })}
                value={typed.x}
              />
            </label>
            <label>
              y
              <input
                inputMode="numeric"
                onChange={(event) => setTyped({ ...typed, y: event.target.value })}
                value={typed.y}
              />
            </label>
            <button disabled={!typedValid || typedRefusal !== null} type="submit">
              Add base
            </button>
            {typedRefusal !== null && <p className="bp-refused">{refusalText(typedRefusal)}</p>}
          </form>

          <h3>Structures</h3>
          {structures.map((s) => (
            <fieldset className="bp-structure" key={s.id}>
              <legend>{s.name || 'Structure'}</legend>
              <label>
                Name
                <input
                  onChange={(event) => editStructure(s.id, { name: event.target.value })}
                  value={s.name}
                />
              </label>
              <div className="bp-row">
                <label>
                  x
                  <input
                    inputMode="numeric"
                    onChange={(event) => editStructure(s.id, { x: toInt(event.target.value, s.x) })}
                    value={s.x}
                  />
                </label>
                <label>
                  y
                  <input
                    inputMode="numeric"
                    onChange={(event) => editStructure(s.id, { y: toInt(event.target.value, s.y) })}
                    value={s.y}
                  />
                </label>
                <label>
                  Footprint
                  <input
                    inputMode="numeric"
                    onChange={(event) => {
                      const n = toInt(event.target.value, s.footprint);
                      if (validSide(n)) editStructure(s.id, { footprint: n });
                    }}
                    value={s.footprint}
                  />
                </label>
                <label>
                  Territory
                  <input
                    inputMode="numeric"
                    onChange={(event) => {
                      if (event.target.value.trim() === '') {
                        editStructure(s.id, { area: null });
                        return;
                      }
                      const n = toInt(event.target.value, s.area ?? 0);
                      if (validSide(n)) editStructure(s.id, { area: n });
                    }}
                    placeholder="none"
                    value={s.area ?? ''}
                  />
                </label>
              </div>
              <button
                disabled={structures.length === 1}
                onClick={() =>
                  update({ ...state, structures: structures.filter((o) => o.id !== s.id) })
                }
                type="button"
              >
                Remove
              </button>
            </fieldset>
          ))}
          <p className="bp-note">
            Footprint and territory are odd sizes: the structure sits on the centre tile.
          </p>
          <button
            onClick={() =>
              update({
                ...state,
                structures: [
                  ...structures,
                  { id: newId(), name: 'Structure', x: 377, y: 436, ...TRADE_SHOP },
                ],
              })
            }
            type="button"
          >
            Add a structure
          </button>

          {bases.length > 0 && (
            <>
              <h3>Bases</h3>
              <pre className="bp-list">{coordinateList(bases)}</pre>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
