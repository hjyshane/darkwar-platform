// Drawing the world map with plain DOM — no React here, and it stays that
// way (see CLAUDE.md). The layout maths (which markers are on the map, where
// each one sits, what its label says, what classes it carries) lives in
// @dw/ui's mapLayout, shared with the dashboard's MapCanvas.tsx. This module
// only turns that answer into DOM nodes; nothing here computes a position.
//
// TEXTCONTENT ONLY. A pin's label and title come from a player's own name,
// read out of the journal — somebody else's input arriving on our screen.
// `tauri.conf.json` has `csp: null`, so there is no second line of defence
// behind that rule.
import '@dw/ui/map.css';
import { MAP_INSET, type MapMarker, checkMapImageSize, layoutMarkers } from '@dw/ui';

// Vite serves this from apps/desktop/public/ at a root-relative path, same
// as the dashboard's own public/map.webp — but it is a SEPARATE copy (see
// apps/desktop/public/map.webp), so this is its own constant rather than the
// package's MAP_IMAGE_URL default. MapCanvas.tsx documents why the URL is a
// parameter at all: the dashboard and this app resolve a root-relative path
// against two different `public/` directories.
const DESKTOP_MAP_IMAGE_URL = '/map.webp';

let frameEl: HTMLDivElement | null = null;
let plotEl: HTMLDivElement | null = null;
let warningEl: HTMLElement | null = null;

/** Builds the map figure once — the picture and its frame are never
 * rebuilt. Call `renderMarkers` (repeatedly, once per search) to draw pins
 * into the plot this returns. */
export function createMapView(): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'map-canvas';

  frameEl = document.createElement('div');
  frameEl.className = 'map-frame';

  const image = document.createElement('img');
  image.className = 'map-frame__image';
  image.alt = 'World map';
  // Without a picture the feature still works — the frame falls back to
  // `map-frame--empty`'s grid and every pin is still in the right place
  // relative to the others, the same fallback MapCanvas.tsx uses.
  image.addEventListener('error', () => {
    frameEl?.classList.add('map-frame--empty');
    image.remove();
  });
  image.addEventListener('load', () => {
    checkImageSize(image.naturalWidth, image.naturalHeight);
  });
  image.src = DESKTOP_MAP_IMAGE_URL;
  frameEl.appendChild(image);

  plotEl = document.createElement('div');
  plotEl.className = 'map-plot';
  plotEl.style.left = `${MAP_INSET.left * 100}%`;
  plotEl.style.top = `${MAP_INSET.top * 100}%`;
  plotEl.style.right = `${MAP_INSET.right * 100}%`;
  plotEl.style.bottom = `${MAP_INSET.bottom * 100}%`;
  frameEl.appendChild(plotEl);

  figure.appendChild(frameEl);

  warningEl = document.createElement('figcaption');
  warningEl.className = 'map-size-warning';
  warningEl.setAttribute('role', 'alert');
  warningEl.hidden = true;
  figure.appendChild(warningEl);

  return figure;
}

// The comment on MAP_INSET (packages/ui/src/mapLayout.ts) says plainly that
// the picture will be replaced when the game changes the map, and that every
// pin silently moves when it is. The comparison and its wording live in
// @dw/ui's checkMapImageSize — the same function MapCanvas.tsx calls on its
// own `onLoad` — so this only decides where the resulting text goes: a loud
// standing banner rather than a thrown error or a blanked map, so the map
// (and its pins, however wrong) keeps rendering underneath it for a player
// who did nothing wrong.
function checkImageSize(naturalWidth: number, naturalHeight: number): void {
  if (warningEl === null) {
    return;
  }
  const message = checkMapImageSize(naturalWidth, naturalHeight);
  if (message === null) {
    warningEl.hidden = true;
    warningEl.textContent = '';
    return;
  }
  console.error(message);
  // TEXTCONTENT ONLY — see the file-level note: this text can originate from
  // a picture dropped in by whoever replaced it, not from a player, but the
  // module-wide rule is textContent everywhere regardless.
  warningEl.textContent = message;
  warningEl.hidden = false;
}

/** Redraws every pin from scratch — called after every search. Markers off
 * the map (see `isOnMap`) are simply not among the ones `layoutMarkers`
 * hands back, so nothing here needs to filter them itself. */
export function renderMarkers(markers: readonly MapMarker[]): void {
  if (plotEl === null) {
    return;
  }
  while (plotEl.firstChild !== null) {
    plotEl.removeChild(plotEl.firstChild);
  }

  for (const { key, position, className, showLabel, label, title } of layoutMarkers(markers)) {
    const pin = document.createElement('span');
    pin.className = className;
    pin.style.left = position.left;
    pin.style.top = position.top;
    pin.title = title;
    pin.dataset.key = key;

    const dot = document.createElement('span');
    dot.className = 'map-pin__dot';
    pin.appendChild(dot);

    if (showLabel) {
      const labelEl = document.createElement('span');
      labelEl.className = 'map-pin__label';
      labelEl.textContent = label;
      pin.appendChild(labelEl);
    }

    plotEl.appendChild(pin);
  }
}
