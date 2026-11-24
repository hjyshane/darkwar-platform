import { type RefObject, useEffect, useRef, useState } from 'react';
import { useIsCommunity } from '../../lib/communityAccess';
import { useT } from '../../lib/i18n';
import { MAP_LAYERS, type MapLayer, type MapLayers, hiddenCount } from './layers';

/** What the map is being read for. Each mode is a preset over the same data:
 * which bases stay bright, how far out names start, and which layers show. */
// No Targets or Shields mode: they were presets of the sidebar's All / Shield /
// No shield filter, which already does both (operator, 2026-11-18).
export type MapMode = 'map' | 'territory' | 'plunder' | 'plan';

export const MAP_MODES: ReadonlyArray<{ id: MapMode; label: string; hint: string }> = [
  { id: 'map', label: 'Map', hint: 'Every swept base, coloured by alliance' },
  { id: 'territory', label: 'Territory', hint: 'Alliance ground only, no player names' },
  {
    id: 'plan',
    label: 'Plan',
    hint: 'The hive plan: green where a base stands on its tile, red where not',
  },
  {
    id: 'plunder',
    label: 'Plunder',
    hint: 'Trucks, plunder missions and Large Treasure Spots, bases dimmed',
  },
];

/** Close a floating menu on Escape or a pointer down outside `root`. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, root, close]);
}

/** The mode switch floating on the map: a pill showing the current mode that
 * opens a short list. Closes on a pick, Escape or a click elsewhere. */
export function MapModeMenu({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The hive plan is our alliance's (0165); a community account (0282) cannot
  // read it, so the mode that draws it is not offered.
  const isCommunity = useIsCommunity();
  const modes = MAP_MODES.filter((m) => !(isCommunity && m.id === 'plan'));
  const current = modes.find((m) => m.id === mode) ?? modes[0];

  useDismiss(open, root, () => setOpen(false));

  return (
    <div className="atlas-modes" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="atlas-modes__button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {current ? t(current.label) : undefined}
        <span aria-hidden="true" className="atlas-modes__caret">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="atlas-modes__menu" role="menu">
          {modes.map((item) => (
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
              title={t(item.hint)}
              type="button"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The layer switch beside the mode: a pill naming how many kinds are hidden,
 * opening a checklist of the five. Each is a plain checkbox, so several can be
 * changed before the menu is closed; it stays open until Escape or a click away. */
export function MapLayerMenu({
  layers,
  onChange,
}: {
  layers: MapLayers;
  onChange: (layer: MapLayer, on: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => setOpen(false));
  const hidden = hiddenCount(layers);

  return (
    <div className="atlas-modes atlas-layers" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className={
          hidden > 0 ? 'atlas-modes__button atlas-layers__button--some' : 'atlas-modes__button'
        }
        onClick={() => setOpen((value) => !value)}
        title={t('Choose what the map draws')}
        type="button"
      >
        {t('Layers')}
        {hidden > 0 && (
          <span className="atlas-layers__badge">{t('{count} off', { count: hidden })}</span>
        )}
        <span aria-hidden="true" className="atlas-modes__caret">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="atlas-modes__menu atlas-layers__menu">
          {MAP_LAYERS.map((item) => (
            <label
              className={
                layers[item.id]
                  ? 'atlas-layers__item'
                  : 'atlas-layers__item atlas-layers__item--off'
              }
              key={item.id}
            >
              <input
                checked={layers[item.id]}
                onChange={(event) => onChange(item.id, event.target.checked)}
                type="checkbox"
              />
              <span>{t(item.label)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
