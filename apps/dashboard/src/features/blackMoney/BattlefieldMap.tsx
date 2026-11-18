import { useState } from 'react';
import {
  OBJECTIVES,
  OBJECTIVE_FACTS,
  type Objective,
  type ObjectiveKind,
  SCATTERED_NOTE,
  placed,
} from './battlefield';

const SIZE = 100;
const STAR = '0,-5 1.5,-1.6 5,-1.5 2.3,0.8 3.2,4.5 0,2.4 -3.2,4.5 -2.3,0.8 -5,-1.5 -1.5,-1.6';
const DROP = 'M0,-5 C3,-1 4,1 4,2.5 A4,4 0 0 1 -4,2.5 C-4,1 -3,-1 0,-5 Z';
const HOUSE = 'M-5,1 L0,-5 L5,1 L5,5 L-5,5 Z';
const PLUS = 'M-1.6,-5 H1.6 V-1.6 H5 V1.6 H1.6 V5 H-1.6 V1.6 H-5 V-1.6 H-1.6 Z';
const SHIELD = 'M-4.5,-4 H4.5 V1.5 C4.5,4 1.5,5 0,5.5 C-1.5,5 -4.5,4 -4.5,1.5 Z';

function Glyph({ kind }: { kind: ObjectiveKind }) {
  switch (kind) {
    case 'military':
      return <polygon points={STAR} />;
    case 'hospital':
      return <path d={PLUS} />;
    case 'refinery':
      return <path d={DROP} />;
    case 'factory':
      return <path d={HOUSE} />;
    default:
      return <path d={SHIELD} />;
  }
}

function Marker({
  objective,
  flipped,
  count,
  highlighted,
}: {
  objective: Objective;
  flipped: boolean;
  count: number;
  highlighted: boolean;
}) {
  const at = placed(objective, flipped);
  const side =
    objective.id === 'hq-ours' ? 'ours' : objective.id === 'hq-theirs' ? 'theirs' : 'neutral';
  return (
    <g
      className={`bf-marker bf-${side}${highlighted ? ' bf-highlight' : ''}`}
      transform={`translate(${at.x * SIZE} ${at.y * SIZE})`}
    >
      <title>{count > 0 ? `${objective.label}: ${count}` : objective.label}</title>
      <Glyph kind={objective.kind} />
      {count > 0 && (
        <text className="bf-count" x="6" y="-4">
          {count}
        </text>
      )}
    </g>
  );
}

/** The picture alone. `counts` puts a number beside an objective (how many
 * players a plan sends there); `highlight` rings one (the reader's own). */
export function BattlefieldSvg({
  flipped,
  counts,
  highlight,
}: {
  flipped: boolean;
  counts?: ReadonlyMap<string, number>;
  highlight?: string | null;
}) {
  return (
    <svg
      aria-label="Black Gold battlefield: headquarters in opposite corners, two military bases, two field hospitals, six oil refineries and the rare earth factory in the centre"
      className="bf-map"
      role="img"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
    >
      <rect className="bf-ground" height={SIZE} rx="4" width={SIZE} />
      {OBJECTIVES.map((objective) => (
        <Marker
          count={counts?.get(objective.id) ?? 0}
          flipped={flipped}
          highlighted={highlight === objective.id}
          key={objective.id}
          objective={objective}
        />
      ))}
    </svg>
  );
}

/** Which corner is ours, as two pressed buttons. */
export function OrientationToggle({
  flipped,
  onChange,
}: {
  flipped: boolean;
  onChange: (flipped: boolean) => void;
}) {
  return (
    <fieldset className="bf-orient">
      <legend>Our headquarters is</legend>
      <button aria-pressed={!flipped} onClick={() => onChange(false)} type="button">
        Bottom left
      </button>
      <button aria-pressed={flipped} onClick={() => onChange(true)} type="button">
        Top right
      </button>
    </fieldset>
  );
}

/** The Black Gold battlefield as a picture and a reference table.
 *
 * READ-ONLY. Drawn rather than copied from the game's art; the figures beside
 * it are the game's own event text (see battlefield.ts). Our headquarters is
 * the bottom left by default and the picture turns half a turn when the
 * battle put us at the top right.
 */
export function Battlefield() {
  const [flipped, setFlipped] = useState(false);
  return (
    <details className="panel bf-panel">
      <summary>Battlefield map and objectives</summary>
      <div className="bf-layout">
        <div>
          <OrientationToggle flipped={flipped} onChange={setFlipped} />
          <BattlefieldSvg flipped={flipped} />
          <p className="subtle">
            Red-and-blue corners are the two headquarters; the star is a Military Base, the cross a
            Field Hospital, the drop an Oil Refinery. Which side is ours changes from battle to
            battle.
          </p>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th scope="col">Objective</th>
                <th scope="col" className="numeric">
                  On map
                </th>
                <th scope="col" className="numeric">
                  First control
                </th>
                <th scope="col" className="numeric">
                  Held
                </th>
              </tr>
            </thead>
            <tbody>
              {OBJECTIVE_FACTS.map((fact) => (
                <tr key={fact.kind}>
                  <th scope="row">
                    {fact.name}
                    <br />
                    <span className="muted">{fact.note}</span>
                  </th>
                  <td className="numeric">{fact.count}</td>
                  <td className="numeric">{fact.first}</td>
                  <td className="numeric">{fact.sustained}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="subtle">Points are alliance / personal. {SCATTERED_NOTE}</p>
          <p className="subtle">
            From the game&apos;s own event screens, not from capture; the game can change them.
          </p>
        </div>
      </div>
    </details>
  );
}
