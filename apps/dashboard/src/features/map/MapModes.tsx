import { useEffect, useRef, useState } from 'react';

/** What the map is being read for. Each mode is a preset over the same data:
 * which bases stay bright, how far out names start, and which layers show. */
export type MapMode = 'map' | 'targets' | 'shields' | 'territory' | 'plunder' | 'plan';

export const MAP_MODES: ReadonlyArray<{ id: MapMode; label: string; hint: string }> = [
  { id: 'map', label: 'Map', hint: 'Every swept base, coloured by alliance' },
  { id: 'targets', label: 'Targets', hint: 'Bases with no shield, with their power' },
  { id: 'shields', label: 'Shields', hint: 'Shielded bases, with the time each has left' },
  { id: 'territory', label: 'Territory', hint: 'Alliance ground only, no player names' },
  {
    id: 'plan',
    label: 'Plan',
    hint: 'The hive plan: green where a base stands on its tile, red where not',
  },
  { id: 'plunder', label: 'Plunder', hint: 'Trucks and plunder missions, bases dimmed' },
];

/** The mode switch floating on the map: a pill showing the current mode that
 * opens a short list. Closes on a pick, Escape or a click elsewhere. */
export function MapModeMenu({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = MAP_MODES.find((m) => m.id === mode) ?? MAP_MODES[0];

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div className="atlas-modes" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="atlas-modes__button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {current?.label}
        <span aria-hidden="true" className="atlas-modes__caret">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="atlas-modes__menu" role="menu">
          {MAP_MODES.map((item) => (
            <button
              aria-checked={item.id === mode}
              className={
                item.id === mode ? 'atlas-modes__item atlas-modes__item--on' : 'atlas-modes__item'
              }
              key={item.id}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
              role="menuitemradio"
              title={item.hint}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
