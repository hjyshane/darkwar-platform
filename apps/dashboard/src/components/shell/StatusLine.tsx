import { useCapturedTimes } from '../../features/eventGuide/data';
import { FALLBACK_SEASONS, useSeasons } from '../../lib/seasons';
import { humanUntil, nextUp, seasonLine } from '../../lib/shellNav';
import { zonedTime } from '../../lib/timezone';
import { SERVER_ZONE } from '../../lib/timezone';
import { Icon } from './icons';
import { useNow } from './useShellNav';

/** The row under the top bar: what time the game thinks it is, which season it
 * is, and what the alliance has on next. All three are things members otherwise
 * work out by hand, and they are the part of this header no other tool has. */
export function StatusLine() {
  const now = useNow(30_000);
  const seasons = useSeasons();
  const times = useCapturedTimes();
  const season = seasonLine(seasons.data ?? FALLBACK_SEASONS, now);
  const next = nextUp(times.data ?? [], now);

  return (
    <div className="shell-status">
      <span className="shell-status-item">
        <Icon name="clock" size={14} />
        <span className="shell-clock">{zonedTime(now.toISOString(), SERVER_ZONE)}</span>
        <span className="shell-status-muted">server time, UTC−2</span>
      </span>
      {season !== null && <span className="shell-status-item">{season}</span>}
      {next !== null && (
        <span className="shell-status-item">
          Next: {next.title} in <span className="shell-next">{humanUntil(next.inMs)}</span>
        </span>
      )}
    </div>
  );
}
