import {
  LABEL_LIMIT,
  MAP_IMAGE_URL,
  MAP_INSET,
  type MapInset,
  type MapMarker,
  checkMapImageSize,
  layoutMarkers,
} from '@dw/ui';
import { type SyntheticEvent, useState } from 'react';

// The layout maths (position, label rules, classes, title) lives in
// @dw/ui's mapLayout — shared with the desktop app, which draws this same
// map with plain DOM and no React. This component only turns that into JSX.
//
// Re-exported so existing imports (MapCanvas.test.ts among them) keep
// working unchanged: this is still where the dashboard looks for them.
export { LABEL_LIMIT, MAP_IMAGE_URL, MAP_INSET };
export type { MapInset, MapMarker };

export function MapCanvas({
  markers,
  caption,
  calibrate = false,
  inset = MAP_INSET,
  // Vite serves this from `public/` at a root-relative path; Tauri's
  // webview (apps/desktop, Task 5) resolves that differently, so the URL is
  // a parameter rather than baked in. Defaulting to MAP_IMAGE_URL means the
  // dashboard resolves exactly what it always has — nothing here changes
  // unless a caller explicitly passes its own.
  imageUrl = MAP_IMAGE_URL,
  onSelect,
}: {
  markers: readonly MapMarker[];
  caption?: string;
  /** Draw the map's own bounds, to check them against the picture. */
  calibrate?: boolean;
  inset?: MapInset;
  /** Where to load the map picture from. Defaults to `MAP_IMAGE_URL`
   * (Vite's `public/` root); pass a different value where that resolution
   * does not apply. */
  imageUrl?: string;
  /** Given, every pin becomes clickable. */
  onSelect?: (marker: MapMarker) => void;
}) {
  // An absent image is a normal state, not an error: the feature works
  // without it and says so, rather than showing a broken-image glyph over a
  // marker that is in the right place.
  const [hasImage, setHasImage] = useState(true);
  // Set only when the loaded picture's own size disagrees with the size
  // MAP_INSET was measured against — see `checkImageSize` below for why this
  // is a banner and not a thrown error or a blanked map.
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const positioned = layoutMarkers(markers, { clickable: onSelect !== undefined });

  // The comment on MAP_INSET says plainly that the picture will be replaced
  // when the game changes the map, and that every pin silently moves when it
  // is. This is where the picture's real size becomes known, so this is
  // where that gets checked — once, on load, against the size MAP_INSET was
  // measured against. The comparison and its wording live in @dw/ui's
  // checkMapImageSize (shared with the desktop app's mapView.ts); this
  // component only decides what to do with the result.
  //
  // A thrown error or a blanked map would be impossible to miss too, but
  // would also take the map away from every player the moment someone drops
  // in a new picture, before anyone has had a chance to remeasure MAP_INSET.
  // A loud, standing banner is visible to whoever replaced the picture (and
  // stays visible until they fix it) without taking the map away from a
  // player who did nothing wrong — the map keeps rendering underneath it,
  // pins included, on the (possibly now-wrong) fractions it already has.
  function checkImageSize(event: SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const message = checkMapImageSize(naturalWidth, naturalHeight);
    if (message !== null) {
      console.error(message);
    }
    setSizeWarning(message);
  }

  // The plot is the INNER rectangle. Markers are placed as fractions of it,
  // never of the image, which is what keeps the frame out of the arithmetic.
  const plotStyle = {
    left: `${inset.left * 100}%`,
    top: `${inset.top * 100}%`,
    right: `${inset.right * 100}%`,
    bottom: `${inset.bottom * 100}%`,
  };

  return (
    <figure className="map-canvas">
      <div className={hasImage ? 'map-frame' : 'map-frame map-frame--empty'}>
        {hasImage && (
          <img
            alt="World map"
            className="map-frame__image"
            onError={() => setHasImage(false)}
            onLoad={checkImageSize}
            src={imageUrl}
          />
        )}
        <div className={calibrate ? 'map-plot map-plot--calibrate' : 'map-plot'} style={plotStyle}>
          {positioned.map(({ key, marker, position, className, showLabel, label, title }) => {
            // A button only when there is somewhere for the click to go. A
            // pin that looks pressable and does nothing is worse than a dot.
            return onSelect ? (
              <button
                className={className}
                key={key}
                onClick={() => onSelect(marker)}
                style={position}
                title={title}
                type="button"
              >
                <span className="map-pin__dot" />
                {showLabel && <span className="map-pin__label">{label}</span>}
              </button>
            ) : (
              <span className={className} key={key} style={position} title={title}>
                <span className="map-pin__dot" />
                {showLabel && <span className="map-pin__label">{label}</span>}
              </span>
            );
          })}
          {calibrate && (
            <>
              {/* The two corners the coordinate system is defined by. If
                  these do not land on the inside of the green border, the
                  inset is wrong and every marker is out by the difference. */}
              <span className="map-edge map-edge--tl">0, 999</span>
              <span className="map-edge map-edge--br">999, 0</span>
            </>
          )}
        </div>
      </div>
      {!hasImage && (
        <figcaption className="subtle">
          No map picture yet — positions are drawn on the grid. Drop the image at{' '}
          <code>apps/dashboard/public/map.png</code> and it appears behind them.
        </figcaption>
      )}
      {sizeWarning && (
        <figcaption className="map-size-warning" role="alert">
          {sizeWarning}
        </figcaption>
      )}
      {caption && <figcaption className="subtle">{caption}</figcaption>}
    </figure>
  );
}
