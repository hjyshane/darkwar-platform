// One level, now and wanted: shows the current level (as the game names it)
// and lets the reader pick a higher one. Picking the current level again
// clears the target. On an account entered by hand the current level is an
// input too (`onCurrent`).

import { type Tiers, levelLabel, levelText } from './levels';

interface LevelPickerProps {
  /** What is being raised, for the accessible name: "Watchtower level". */
  label: string;
  /** For tier lookup; buildings only have tiers. */
  subject: string;
  current: number;
  max: number;
  target: number | undefined;
  tiers: Tiers;
  onChange: (to: number) => void;
  /** Set on a hand-entered account: the current level becomes editable. */
  onCurrent?: (level: number) => void;
}

export function LevelPicker({
  label,
  subject,
  current,
  max,
  target,
  tiers,
  onChange,
  onCurrent,
}: LevelPickerProps) {
  const now = levelLabel(tiers, subject, current);
  const levels: number[] = [];
  for (let level = current; level <= Math.max(current, max); level += 1) levels.push(level);
  const raised = target !== undefined && target > current;
  return (
    <span className={`level-picker${raised ? ' level-picker-raised' : ''}`}>
      {onCurrent ? (
        <span className="level-now">
          <input
            aria-label={`${label}: now`}
            className="level-input"
            max={max}
            min={0}
            onChange={(e) =>
              onCurrent(Math.max(0, Math.min(max, Math.trunc(Number(e.target.value) || 0))))
            }
            type="number"
            value={current}
          />
          {now.sub !== null && <small className="level-sub">{now.main}</small>}
        </span>
      ) : (
        <span className="level-now">
          {now.main}
          {now.sub !== null && <small className="level-sub">{now.sub}</small>}
        </span>
      )}
      {current >= max ? (
        <span className="subtle level-max">max</span>
      ) : (
        <select
          aria-label={`${label}: target`}
          onChange={(e) => onChange(Number(e.target.value))}
          value={target ?? current}
        >
          {levels.map((level) => (
            <option key={level} value={level}>
              {level === current ? '—' : `→ ${levelText(tiers, subject, level)}`}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
