export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where to put a tooltip of `tip` size relative to its `anchor`: centred under
 * it, flipped above when there is no room below, and kept inside the viewport
 * on both sides so a long line near an edge is not cut off. */
export function placeTip(
  anchor: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): { left: number; top: number; above: boolean } {
  const below = anchor.top + anchor.height + gap;
  const above =
    below + tip.height > viewport.height - margin && anchor.top - gap - tip.height > margin;
  const top = above ? anchor.top - gap - tip.height : below;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(margin, Math.min(centred, viewport.width - tip.width - margin));
  return { left, top, above };
}
