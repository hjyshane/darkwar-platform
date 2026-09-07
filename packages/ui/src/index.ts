export type { Coordinate, Fraction } from './mapProjection';
export {
  MAP_MIN,
  MAP_MAX,
  MAP_TILES,
  toFraction,
  fromFraction,
  isOnMap,
  formatCoordinate,
} from './mapProjection';

export type { MapInset, MapMarker, LayoutMarkersOptions, PositionedMarker } from './mapLayout';
export { MAP_IMAGE_URL, MAP_INSET, LABEL_LIMIT, layoutMarkers } from './mapLayout';
