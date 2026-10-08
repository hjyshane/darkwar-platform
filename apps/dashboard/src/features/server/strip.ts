// The figures at the head of the Server screen, from the two boards already
// loaded. Pure, so what the strip claims can be checked on its own.
//
// The boards are what the collector has SEEN, not the server's population, so
// every count says so. "Strongest" is the top of each board by power; a row
// without a power figure is not a candidate, because null is not zero.

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

interface AllianceLike {
  name: string | null;
  code: string | null;
  power: number | null;
}

interface PlayerLike {
  name: string | null;
  game_uid?: number | null;
  power: number | null;
}

const plain = new Intl.NumberFormat('en');

function strongest<T extends { power: number | null }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.power !== null && (best === null || row.power > (best.power ?? 0))) best = row;
  }
  return best;
}

export function serverStrip(
  alliances: readonly AllianceLike[],
  players: readonly PlayerLike[],
): StripCell[] {
  const topAlliance = strongest(alliances);
  const topPlayer = strongest(players);
  return [
    { label: 'Alliances seen', value: plain.format(alliances.length) },
    {
      label: 'Players seen',
      value: plain.format(players.length),
      note: 'the newest capture of the board',
    },
    {
      label: 'Strongest alliance',
      value:
        topAlliance === null
          ? null
          : `${topAlliance.code ? `[${topAlliance.code}] ` : ''}${topAlliance.name ?? 'Unnamed'}`,
      note: topAlliance?.power == null ? undefined : `${plain.format(topAlliance.power)} power`,
    },
    {
      label: 'Strongest player',
      value:
        topPlayer === null
          ? null
          : (topPlayer.name ??
            (topPlayer.game_uid != null ? `UID ${topPlayer.game_uid}` : 'Unnamed')),
      note: topPlayer?.power == null ? undefined : `${plain.format(topPlayer.power)} power`,
    },
  ];
}
