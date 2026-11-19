// The bar between the editor's map and its side panel: drag it to make the
// panel wider or narrower — for the alliance whose names do not fit.

import { useState } from 'react';

/** How far one arrow-key press moves it, in CSS pixels; Shift moves three. */
const KEY_STEP = 20;

/**
 * ON THE PANEL'S LEFT EDGE, so dragging it LEFT widens the panel: the panel
 * grows toward the map, which is where the bar is. Double-click hands the
 * width back to the default, like the map's own corner handle.
 */
export function PanelDivider({
  width,
  min,
  max,
  onResize,
}: {
  /** The panel's width as it is now. */
  width: number;
  min: number;
  max: number;
  onResize: (width: number | null) => void;
}) {
  const [held, setHeld] = useState<{ x: number; width: number } | null>(null);
  const report = (next: number) => onResize(Math.round(Math.min(max, Math.max(min, next))));

  return (
    <span
      aria-label="Panel width. Drag, or use the arrow keys; double-click to reset."
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels wide`}
      className={
        held === null ? 'hive-panel__divider' : 'hive-panel__divider hive-panel__divider--held'
      }
      onDoubleClick={() => onResize(null)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP;
        // Left widens, as a drag to the left does.
        const grow = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
        if (grow !== 0) {
          event.preventDefault();
          report(width + grow);
        } else if (event.key === 'Home') {
          event.preventDefault();
          report(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          report(max);
        }
      }}
      onLostPointerCapture={() => setHeld(null)}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld({ x: event.clientX, width });
      }}
      onPointerMove={(event) => {
        if (held !== null) {
          report(held.width - (event.clientX - held.x));
        }
      }}
      onPointerUp={() => setHeld(null)}
      role="slider"
      tabIndex={0}
    />
  );
}
