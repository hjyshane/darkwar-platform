// One level, now and wanted: shows the current level (as the game names it)
// and lets the reader pick a higher one. Picking the current level again
// clears the target.

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
}

export function LevelPicker({
  label,
  subject,
  current,
  max,
  target,
  tiers,
  onChange,
}: LevelPickerProps) {
  const now = levelLabel(tiers, subject, current);
  const levels: number[] = [];
  for (let level = current; level <= Math.max(current, max); level += 1) levels.push(level);
  const raised = target !== undefined && target > current;
  return (
    <span className={`level-picker${raised ? ' level-picker-raised' : ''}`}>
      <span className="level-now">
        {now.main}
        {now.sub !== null && <small className="level-sub">{now.sub}</small>}
      </span>
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
