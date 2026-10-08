import type { IconName } from '../../lib/shellNav';

/** The sidebar's icons, drawn here because the app takes no icon library (the
 * CSP and the 150 kB budget both say no). One stroke each, on a 24px grid, in
 * the colour of the text beside them. */
const PATHS: Record<IconName | 'search' | 'menu' | 'clock' | 'collapse' | 'close', string> = {
  overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  rankings: 'M5 20V10M12 20V4M19 20v-7',
  migration: 'M4 8h14l-4-4M20 16H6l4 4',
  map: 'M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10zM12 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  alliance:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M17 15c2.5 0 4 1.7 4 4',
  members: 'M5 6h14M5 12h14M5 18h14',
  hive: 'M12 3l7 4v10l-7 4-7-4V7z',
  season: 'M5 21V4M5 5h12l-2 4 2 4H5',
  blackGold: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 10h5a2 2 0 0 1 0 4H9M12 7v10',
  participation: 'M4 12l5 5L20 6',
  planner: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  guide: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  shop: 'M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0',
  notices: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  guides: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 8h7',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  collapse: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
