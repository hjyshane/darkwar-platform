import { type Coordinate, MAP_INSET, toFraction } from '@dw/ui';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export const MIN_ZOOM = 1;
/** Deep enough that one base fills a few hundred pixels and its name has room. */
export const MAX_ZOOM = 64;
/** Zoom a list click lands on: close enough to tell neighbouring pins apart. */
export const FOCUS_ZOOM = 12;
const DRAG_THRESHOLD_PX = 4;

export interface View {
  zoom: number;
  /** Where the top-left corner of the picture sits, in screen pixels, <= 0. */
  x: number;
  y: number;
}

export const HOME: View = { zoom: 1, x: 0, y: 0 };

/** The window's zoom, in half steps, for what is drawn inside it and has to
 * decide what to show (the clump names). Half steps so a slow wheel does not
 * redraw the map on every tick. */
const ZoomContext = createContext(1);
export const useMapZoom = () => useContext(ZoomContext);

/** How much one wheel event zooms by. Proportional to how far the wheel moved,
 * so a notch of a mouse is a small step (about 13%) and a trackpad's stream of
 * tiny deltas is smooth, where a fixed 25% per event jumped a whole level at a
 * time. Capped so a fast flick cannot cross several levels at once. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const lines = deltaMode === 1 ? 33 : deltaMode === 2 ? 400 : 1;
  const moved = Math.max(-240, Math.min(240, deltaY * lines));
  return Math.exp(-moved * 0.0012);
}

/** Keeps the picture covering the window: dragging past an edge stops there. */
export function clampView(view: View, width: number, height: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  return {
    zoom,
    x: Math.min(0, Math.max(width * (1 - zoom), view.x)),
    y: Math.min(0, Math.max(height * (1 - zoom), view.y)),
  };
}

/** Zoom by `factor` keeping the point under the cursor where it is. */
export function zoomAt(view: View, factor: number, px: number, py: number, w: number, h: number) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const k = zoom / view.zoom;
  return clampView({ zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, w, h);
}

/** Where a tile sits in the whole picture, as fractions of it. The plot is the
 * picture minus its frame, which is what MAP_INSET measures. */
export function pictureFraction(at: Coordinate): { fx: number; fy: number } {
  const f = toFraction(at);
  return {
    fx: MAP_INSET.left + f.left * (1 - MAP_INSET.left - MAP_INSET.right),
    fy: MAP_INSET.top + f.top * (1 - MAP_INSET.top - MAP_INSET.bottom),
  };
}

/** The view that puts `at` in the middle of a w x h window at `zoom`. */
export function centreOn(at: Coordinate, zoom: number, w: number, h: number): View {
  const { fx, fy } = pictureFraction(at);
  return clampView({ zoom, x: w / 2 - fx * w * zoom, y: h / 2 - fy * h * zoom }, w, h);
}

/** A window onto the map that can be dragged, zoomed with the wheel or the
 * buttons, and sent to a tile with `focus`.
 *
 * Pins keep their size while the picture scales: the stylesheet divides them by
 * `--map-zoom`. A drag that moves further than a few pixels is not a click, so
 * letting go over a pin does not select it.
 */
export function PannableMap({
  children,
  focus,
}: {
  children: ReactNode;
  /** Change `nonce` to send the window to `at` again, even to the same tile. */
  focus: { at: Coordinate; nonce: number } | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<View>(HOME);
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const size = useCallback(() => {
    const el = frame.current;
    return { w: el?.clientWidth ?? 1, h: el?.clientHeight ?? 1 };
  }, []);

  // The wheel needs preventDefault, and React registers wheel passively. It is
  // taken on the whole stage, not just the picture: the picture keeps its shape
  // and the stage around it is often wider, and a wheel over that empty ground
  // that did nothing read as "zoom works sometimes".
  useEffect(() => {
    const el = root.current;
    const picture = frame.current;
    if (!el || !picture) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = picture.getBoundingClientRect();
      const factor = wheelFactor(event.deltaY, event.deltaMode);
      setView((v) =>
        zoomAt(v, factor, event.clientX - box.left, event.clientY - box.top, box.width, box.height),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const nonce = focus?.nonce;
  const target = focus?.at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new nonce is the trigger; `target` is read with it
  useEffect(() => {
    if (!target) return;
    const { w, h } = size();
    setView((v) => centreOn(target, Math.max(v.zoom, FOCUS_ZOOM), w, h));
  }, [nonce, size]);

  const step = (factor: number) => {
    const { w, h } = size();
    setView((v) => zoomAt(v, factor, w / 2, h / 2, w, h));
  };

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Not every browser lets a page do this (iPhone Safari does not); the button
  // is simply a no-op there rather than a thrown error.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void root.current?.requestFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <ZoomContext.Provider value={Math.round(view.zoom * 2) / 2}>
      <div
        className="pan-map"
        onClickCapture={(event) => {
          // A drag that ends over a pin is not a click on it.
          if (justDragged.current) {
            event.stopPropagation();
            event.preventDefault();
            justDragged.current = false;
          }
        }}
        onPointerDown={(event) => {
          // A fresh press clears a drag whose click never came (it ended on
          // empty ground), so it cannot swallow this press's click.
          justDragged.current = false;
          if ((event.target as Element).closest('.pan-map__tools')) return;
          drag.current = { x: event.clientX, y: event.clientY, from: view, moved: false };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const dx = event.clientX - d.x;
          const dy = event.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          d.moved = true;
          const { w, h } = size();
          setView(clampView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy }, w, h));
        }}
        onPointerUp={() => {
          justDragged.current = drag.current?.moved ?? false;
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        ref={root}
      >
        <div className="pan-map__tools">
          <button
            aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
            onClick={toggleFullscreen}
            type="button"
          >
            {fullscreen ? '✕' : '⛶'}
          </button>
          <button aria-label="Zoom in" onClick={() => step(1.3)} type="button">
            +
          </button>
          <button aria-label="Zoom out" onClick={() => step(1 / 1.3)} type="button">
            −
          </button>
          <button aria-label="Show the whole map" onClick={() => setView(HOME)} type="button">
            ⌂
          </button>
        </div>
        <div
          className={view.zoom > 1 ? 'pan-map__window pan-map__window--zoomed' : 'pan-map__window'}
          ref={frame}
        >
          <div
            className="pan-map__sheet"
            data-zoom={Math.min(MAX_ZOOM, Math.floor(view.zoom))}
            style={
              {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                '--map-zoom': view.zoom,
              } as React.CSSProperties
            }
          >
            {children}
          </div>
        </div>
      </div>
    </ZoomContext.Provider>
  );
}
