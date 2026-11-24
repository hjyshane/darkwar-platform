// The editor's toolbar: one row of icons over the map for everything a click
// or a drag on it means — the drag tool, what a click puts down (kind, size,
// colour), a shape to stamp, and choosing a new anchor — plus what can be done
// to a selection while the select tool is on.
//
// OVER THE MAP, NOT IN THE PANEL. These were the first three sections of the
// Tools tab, each a paragraph and a row of worded buttons, so changing what a
// click did meant leaving the map for a panel that may have been scrolled
// elsewhere. Every one of them is a choice made while looking at the map; here
// they are a glance and a click away from it. The words are still there, as
// each button's name and tooltip.
//
// Menus are <details>: they open and close without a line of state, a
// keyboard reaches them, and a choice closes the one it was made in.

import type { MouseEvent as ReactMouseEvent } from 'react';
import { BASE_SPAN, FRANKIE, TILE_COLOURS, type TileColour } from '../../lib/hiveFormation';
import { useT } from '../../lib/i18n';
import type { Brush, Tool } from './FormationEditor';
import { Icon } from './MapControls';
import type { FormationTemplate, MapFeature } from './hiveFormations';
import { type StampShape, shapeLabel } from './shapeStamp';

export const TOOLS: readonly { tool: Tool; label: string; hint: string; icon: string }[] = [
  {
    tool: 'draw',
    label: 'Move a base',
    hint: 'Drag a base to carry it somewhere else. A click places or removes a tile in every mode.',
    icon: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  },
  {
    tool: 'mark',
    label: 'Fill an area',
    hint: 'Drag out a rectangle and fill every free tile in it with a 1x1 marker, in the brush colour. Goes around what is drawn.',
    icon: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16',
  },
  {
    tool: 'outline',
    label: 'Draw a boundary',
    hint: 'Drag out a rectangle and mark only its edge.',
    icon: 'M4 4h16v16H4z',
  },
  {
    tool: 'erase',
    label: 'Erase an area',
    hint: 'Drag out a rectangle and take its 1x1 markers back out. Bases are left alone.',
    icon: 'M20 20H9l-5-5a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 7M9 9l6 6',
  },
  {
    tool: 'select',
    label: 'Select',
    hint: 'Drag out a rectangle to pick out everything inside it, then move, nudge, paint or remove the group.',
    icon: 'M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4',
  },
];

const BASE_ICON = 'M5 5h14v14H5zM5 12h14M12 5v14';
const STRUCTURE_ICON = 'M5 21V4h12l-3 4 3 4H5';
const SHAPES_ICON = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z';
const ANCHOR_ICON = 'M12 2v5M12 17v5M2 12h5M17 12h5M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8';
const TRASH_ICON = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13';

/** The sizes a click most often puts down, a click away. Each label is a
 * translation key, filled with the size as `{x}` and `{y}`. */
export const SIZES: readonly { spanX: number; spanY: number; label: string }[] = [
  { spanX: 1, spanY: 1, label: '1x1 marker' },
  { spanX: 2, spanY: 2, label: '{x}x{y}' },
  { spanX: BASE_SPAN, spanY: BASE_SPAN, label: '{x}x{y} base' },
  {
    spanX: FRANKIE.spanX,
    spanY: FRANKIE.spanY,
    label: '{x}x{y} Frankie',
  },
];

/** A typed span, or the one already there. A half-typed box must not silently
 * become a 1x1 the next click then places. */
function clampSpan(typed: string, fallback: number): number {
  const value = Number.parseInt(typed, 10);
  return Number.isNaN(value) ? fallback : Math.min(32, Math.max(1, value));
}

/** Close the menu a choice was made in. */
function closeMenu(event: ReactMouseEvent<HTMLElement>) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

/** A chip of the colour, or a dashed empty one for "the default". */
function swatchClass(colour: TileColour | null): string {
  return colour === null ? 'hive-swatch hive-swatch--none' : `hive-swatch hive-swatch--${colour}`;
}

export function EditorToolbar({
  tool,
  onTool,
  brush,
  onBrush,
  features,
  onFeature,
  shapes,
  templates,
  armedKey,
  onShape,
  onTemplate,
  onClear,
  pickingAnchor,
  pickDisabled,
  onPickAnchor,
  selection,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  brush: Brush;
  onBrush: (brush: Brush) => void;
  /** "Things on the map": a brush preset each. */
  features: readonly MapFeature[];
  onFeature: (feature: MapFeature) => void;
  shapes: readonly StampShape[];
  templates: readonly FormationTemplate[];
  /** The shape in hand, if any — its key. */
  armedKey: string | null;
  onShape: (shape: StampShape) => void;
  onTemplate: (template: FormationTemplate) => void;
  onClear: () => void;
  pickingAnchor: boolean;
  /** Why a re-anchor cannot start: there are unsaved changes. */
  pickDisabled: boolean;
  onPickAnchor: () => void;
  selection: {
    count: number;
    onNudge: (byX: number, byY: number) => void;
    onPaint: (colour: TileColour | null) => void;
    onRemove: () => void;
    onDeselect: () => void;
  };
}) {
  const t = useT();
  const sizeLabel = `${brush.spanX}x${brush.spanY}`;
  return (
    <div aria-label={t('Map tools')} className="map-toolbar" role="toolbar">
      {/* WHAT A DRAG DOES. */}
      <div className="map-toolbar__group">
        {TOOLS.map((entry) => (
          <button
            aria-label={t(entry.label)}
            aria-pressed={tool === entry.tool}
            key={entry.tool}
            onClick={() => onTool(entry.tool)}
            title={`${t(entry.label)} — ${t(entry.hint)}`}
            type="button"
          >
            <Icon d={entry.icon} />
          </button>
        ))}
      </div>

      {/* WHAT A CLICK PUTS DOWN: kind, size, colour. */}
      <div className="map-toolbar__group">
        <button
          aria-label={t('A click puts down a member base')}
          aria-pressed={brush.kind === 'base'}
          onClick={() => onBrush({ ...brush, kind: 'base' })}
          title={t('Member base — somebody stands here')}
          type="button"
        >
          <Icon d={BASE_ICON} />
        </button>
        <button
          aria-label={t('A click puts down a structure or marker')}
          aria-pressed={brush.kind === 'structure'}
          onClick={() => onBrush({ ...brush, kind: 'structure' })}
          title={t('Structure or marker — ground that is spoken for')}
          type="button"
        >
          <Icon d={STRUCTURE_ICON} />
        </button>
        <details className="map-toolbar__menu">
          <summary
            aria-label={t('Size {size}', { size: sizeLabel })}
            title={t('What size a click puts down')}
          >
            {sizeLabel}
          </summary>
          <div className="map-toolbar__panel">
            {SIZES.map((size) => (
              <button
                aria-pressed={brush.spanX === size.spanX && brush.spanY === size.spanY}
                key={size.label}
                onClick={(event) => {
                  onBrush({ ...brush, spanX: size.spanX, spanY: size.spanY });
                  closeMenu(event);
                }}
                type="button"
              >
                {t(size.label, { x: size.spanX, y: size.spanY })}
              </button>
            ))}
            <div className="map-toolbar__spans">
              <label>
                <span>{t('Wide')}</span>
                <input
                  max={32}
                  min={1}
                  onChange={(event) =>
                    onBrush({ ...brush, spanX: clampSpan(event.target.value, brush.spanX) })
                  }
                  type="number"
                  value={brush.spanX}
                />
              </label>
              <label>
                <span>{t('Tall')}</span>
                <input
                  max={32}
                  min={1}
                  onChange={(event) =>
                    onBrush({ ...brush, spanY: clampSpan(event.target.value, brush.spanY) })
                  }
                  type="number"
                  value={brush.spanY}
                />
              </label>
            </div>
            {features.length > 0 && (
              <>
                <p className="map-toolbar__note">{t('From the list')}</p>
                {features.map((feature) => (
                  <button
                    aria-pressed={
                      brush.label === feature.name &&
                      brush.spanX === feature.spanX &&
                      brush.spanY === feature.spanY
                    }
                    key={feature.featureId}
                    onClick={(event) => {
                      onFeature(feature);
                      closeMenu(event);
                    }}
                    title={feature.note === '' ? undefined : feature.note}
                    type="button"
                  >
                    <span aria-hidden="true" className={swatchClass(feature.colour)} />
                    {feature.name} {feature.spanX}x{feature.spanY}
                  </button>
                ))}
              </>
            )}
          </div>
        </details>
        <details className="map-toolbar__menu">
          <summary
            aria-label={t('Colour {colour}', { colour: brush.colour ?? t('default') })}
            title={t('What colour a click puts down')}
          >
            <span aria-hidden="true" className={swatchClass(brush.colour)} />
          </summary>
          <div className="map-toolbar__panel map-toolbar__swatches">
            <button
              aria-label={t('Default colour')}
              aria-pressed={brush.colour === null}
              className="hive-swatch"
              onClick={(event) => {
                onBrush({ ...brush, colour: null });
                closeMenu(event);
              }}
              type="button"
            >
              —
            </button>
            {TILE_COLOURS.map((colour) => (
              <button
                aria-label={colour}
                aria-pressed={brush.colour === colour}
                className={swatchClass(colour)}
                key={colour}
                onClick={(event) => {
                  onBrush({ ...brush, colour });
                  closeMenu(event);
                }}
                title={colour}
                type="button"
              />
            ))}
          </div>
        </details>
      </div>

      {/* SHAPES TO STAMP, and choosing the anchor: both are "the next click". */}
      <div className="map-toolbar__group">
        <details className="map-toolbar__menu">
          <summary
            aria-label={t('Shapes to stamp')}
            className={armedKey === null ? undefined : 'map-toolbar__on'}
            title={t('Pick a shape, then click the map to put it down — as often as you like')}
          >
            <Icon d={SHAPES_ICON} />
          </summary>
          <div className="map-toolbar__panel">
            {shapes.map((shape) => (
              <button
                aria-pressed={armedKey === shape.key}
                key={shape.key}
                onClick={(event) => {
                  onShape(shape);
                  closeMenu(event);
                }}
                type="button"
              >
                {shapeLabel(shape, t)}
              </button>
            ))}
            {templates.length > 0 && <p className="map-toolbar__note">{t('Saved shapes')}</p>}
            {templates.map((template) => (
              <button
                aria-pressed={armedKey === `template-${template.templateId}`}
                key={template.templateId}
                onClick={(event) => {
                  onTemplate(template);
                  closeMenu(event);
                }}
                title={template.note === '' ? undefined : template.note}
                type="button"
              >
                {template.name} · {template.bases}
              </button>
            ))}
            <button
              className="map-toolbar__danger"
              onClick={(event) => {
                onClear();
                closeMenu(event);
              }}
              title={t(
                'Take everything off the drawing. Nothing is saved until you press Save; Discard brings it back.',
              )}
              type="button"
            >
              <Icon d={TRASH_ICON} /> {t('Clear the drawing')}
            </button>
          </div>
        </details>
        <button
          aria-label={t('Set the anchor on a base or structure')}
          aria-pressed={pickingAnchor}
          disabled={pickDisabled}
          onClick={onPickAnchor}
          title={
            pickDisabled
              ? t('Save or discard your changes first: setting the anchor rewrites every tile.')
              : t('Set the anchor on a base or structure — nothing on the map moves')
          }
          type="button"
        >
          <Icon d={ANCHOR_ICON} />
        </button>
      </div>

      {/* WHAT CAN BE DONE TO A SELECTION, while there is one. */}
      {tool === 'select' && (
        <div className="map-toolbar__group">
          {selection.count === 0 ? (
            <span className="map-toolbar__note">{t('Drag a box around tiles')}</span>
          ) : (
            <>
              <span className="map-toolbar__note">
                {t('{count} selected', { count: selection.count })}
              </span>
              {(
                [
                  ['←', -1, 0, t('Nudge the selection one tile west'), t('One tile west')],
                  ['→', 1, 0, t('Nudge the selection one tile east'), t('One tile east')],
                  ['↑', 0, 1, t('Nudge the selection one tile north'), t('One tile north')],
                  ['↓', 0, -1, t('Nudge the selection one tile south'), t('One tile south')],
                ] as const
              ).map(([glyph, byX, byY, label, hint]) => (
                <button
                  aria-label={label}
                  key={glyph}
                  onClick={() => selection.onNudge(byX, byY)}
                  title={hint}
                  type="button"
                >
                  {glyph}
                </button>
              ))}
              <details className="map-toolbar__menu">
                <summary aria-label={t('Paint the selection')} title={t('Paint the selection')}>
                  <span aria-hidden="true" className="hive-swatch hive-swatch--amber" />
                </summary>
                <div className="map-toolbar__panel map-toolbar__swatches">
                  <button
                    aria-label={t('Paint the selection the default colour')}
                    className="hive-swatch"
                    onClick={(event) => {
                      selection.onPaint(null);
                      closeMenu(event);
                    }}
                    type="button"
                  >
                    —
                  </button>
                  {TILE_COLOURS.map((colour) => (
                    <button
                      aria-label={t('Paint the selection {colour}', { colour })}
                      className={swatchClass(colour)}
                      key={colour}
                      onClick={(event) => {
                        selection.onPaint(colour);
                        closeMenu(event);
                      }}
                      title={colour}
                      type="button"
                    />
                  ))}
                </div>
              </details>
              <button
                aria-label={t('Remove the {count} selected', { count: selection.count })}
                className="map-toolbar__danger"
                onClick={selection.onRemove}
                title={t('Remove the selected tiles')}
                type="button"
              >
                <Icon d={TRASH_ICON} />
              </button>
              <button
                aria-label={t('Deselect')}
                onClick={selection.onDeselect}
                title={t('Deselect')}
                type="button"
              >
                ×
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
