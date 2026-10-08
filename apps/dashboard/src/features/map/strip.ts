// The figures at the head of the Map screen. Pure, so what the strip claims can
// be checked on its own.
//
// "Showing" says what is on the screen right now. Nothing is drawn until a
// player is named or a level range is asked for, and the strip says that rather
// than reading as "zero bases found".

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

export interface MapStripInput {
  serverId: number;
  /** Already worded ("3 days ago"); null when the sweep time is unknown. */
  swept: string | null;
  scannedServers: number;
  /** Bases on screen from a level range, or null when no range is asked for. */
  levelCount: number | null;
  /** Players the name search found, or null when nothing is typed. */
  nameCount: number | null;
  selected: boolean;
}

const plain = new Intl.NumberFormat('en');
const bases = (count: number) => `${plain.format(count)} base${count === 1 ? '' : 's'}`;

function showing(input: MapStripInput): Pick<StripCell, 'value' | 'note'> {
  if (input.selected) return { value: '1 base', note: 'one player picked out' };
  if (input.levelCount !== null) return { value: bases(input.levelCount), note: 'by HQ level' };
  if (input.nameCount !== null) {
    return {
      value: `${plain.format(input.nameCount)} match${input.nameCount === 1 ? '' : 'es'}`,
      note: 'by name',
    };
  }
  return { value: 'Nothing yet', note: 'name a player or give an HQ level' };
}

export function mapStrip(input: MapStripInput): StripCell[] {
  return [
    { label: 'Server', value: String(input.serverId) },
    {
      label: 'Last swept',
      value: input.swept,
      note: 'positions are only as recent as the sweep',
    },
    { label: 'Servers scanned', value: plain.format(input.scannedServers) },
    { label: 'Showing', ...showing(input) },
  ];
}
