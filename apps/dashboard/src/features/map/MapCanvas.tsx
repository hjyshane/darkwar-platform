import {
  LABEL_LIMIT,
  MAP_IMAGE_URL,
  MAP_INSET,
  type MapInset,
  type MapMarker,
  layoutMarkers,
} from '@dw/ui';
import { useState } from 'react';

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
  onSelect,
}: {
  markers: readonly MapMarker[];
  caption?: string;
  /** Draw the map's own bounds, to check them against the picture. */
  calibrate?: boolean;
  inset?: MapInset;
  /** Given, every pin becomes clickable. */
  onSelect?: (marker: MapMarker) => void;
}) {
  // An absent image is a normal state, not an error: the feature works
  // without it and says so, rather than showing a broken-image glyph over a
  // marker that is in the right place.
  const [hasImage, setHasImage] = useState(true);
  const positioned = layoutMarkers(markers, { clickable: onSelect !== undefined });

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
            src={MAP_IMAGE_URL}
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
      {caption && <figcaption className="subtle">{caption}</figcaption>}
    </figure>
  );
}
