// The figures at the head of the Black Gold screen, from the battles already
// loaded. Pure, so what the strip claims can be checked on its own.
//
// A battle whose result is not known counts toward neither side and not toward
// the win rate: unknown is not a loss. The note says how many there are.

import type { StripCell } from '../../components/Strip';
import { SERVER_ZONE, zonedDayKey } from '../../lib/timezone';
import { type Battle, outcome, teamLabel } from './data';

const plain = new Intl.NumberFormat('en');

export function blackGoldStrip(battles: readonly Battle[]): StripCell[] {
  if (battles.length === 0) return [];
  let wins = 0;
  let losses = 0;
  for (const battle of battles) {
    const result = outcome(battle);
    if (result === 'win') wins += 1;
    else if (result === 'loss') losses += 1;
  }
  const known = wins + losses;
  const unknown = battles.length - known;
  const reports = battles.filter((battle) => battle.report_seen === true).length;
  const latest = [...battles].sort((a, b) => b.battle_ended_at.localeCompare(a.battle_ended_at))[0];
  const latestResult = latest === undefined ? 'unknown' : outcome(latest);
  return [
    {
      label: 'Record',
      value: `${wins} – ${losses}`,
      note:
        unknown === 0
          ? `${plain.format(battles.length)} battles captured`
          : `${plain.format(battles.length)} captured, ${plain.format(unknown)} with no result yet`,
    },
    {
      label: 'Win rate',
      value: known === 0 ? null : `${Math.round((wins / known) * 100)}%`,
      note: known === 0 ? undefined : `of ${plain.format(known)} with a result`,
    },
    {
      label: 'Latest',
      value: latestResult === 'win' ? 'Win' : latestResult === 'loss' ? 'Loss' : 'Result unknown',
      note:
        latest === undefined
          ? undefined
          : `${zonedDayKey(latest.battle_ended_at, SERVER_ZONE)} · ${teamLabel(latest.team_index)}`,
    },
    {
      label: 'Reports in',
      value: `${plain.format(reports)} of ${plain.format(battles.length)}`,
      note: 'who played is known only from a report',
    },
  ];
}
