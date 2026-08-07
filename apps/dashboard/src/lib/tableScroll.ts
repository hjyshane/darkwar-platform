/** Scrolling a wide table sideways with the mouse.
 *
 * THE PROBLEM, STATED HONESTLY. A tilt wheel reaches the browser one of two ways
 * and we cannot choose which. Most drivers send it as a `wheel` event carrying
 * `deltaX`, and then every `overflow-x: auto` element already scrolls — there is
 * nothing for us to add and a handler would double the movement. Some drivers,
 * including Logitech's by default, bind tilt to the fourth and fifth mouse
 * buttons instead, which Chrome delivers as `mousedown` with `button` 3 and 4 and
 * turns into history back and forward. On that hardware no wheel event exists at
 * all, so no amount of wheel handling would have helped, and the table looked
 * broken while Shift+wheel worked.
 *
 * So this handles the buttons, and leaves `deltaX` to the browser.
 *
 * IT ONLY TAKES THE BUTTON WHEN IT CAN USE IT. Back and forward are real controls
 * people rely on. `sidewaysStep` returns 0 when the table has nothing left to
 * scroll that way, and the caller then does NOT preventDefault — so the button
 * still navigates outside a table, still navigates over a table that fits, and
 * still navigates at the end of one. The only thing taken is a press that would
 * otherwise have thrown away a scroll the reader plainly wanted.
 */

/** Chrome's numbering: 3 is the back button, 4 is forward. */
export const BACK_BUTTON = 3;
export const FORWARD_BUTTON = 4;

/** A fraction of the visible width rather than a fixed number of pixels: on a
 * phone-width table a 200px jump is most of the screen, and on a wide one it is
 * barely a column. */
const STEP_FRACTION = 0.2;
/** Below this a "step" stops feeling like a step. */
const MIN_STEP = 64;

export interface Scroller {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** How far this press should move the table, and which way.
 *
 * ZERO MEANS LEAVE IT ALONE, and that is the important return value: it is what
 * keeps the mouse's back button working everywhere it is not being used to scroll.
 * Zero for a button that is not one of the two, for a table with no sideways
 * overflow, and for a table already against the edge it is being pushed towards.
 */
export function sidewaysStep(button: number, box: Scroller): number {
  if (button !== BACK_BUTTON && button !== FORWARD_BUTTON) {
    return 0;
  }
  const overflow = box.scrollWidth - box.clientWidth;
  if (overflow <= 0) {
    return 0;
  }
  const step = Math.max(MIN_STEP, box.clientWidth * STEP_FRACTION);
  if (button === BACK_BUTTON) {
    // Already at the left edge: nothing to give, so the press stays a Back.
    // Rounded because a scrollLeft can be fractional on a zoomed page, and a
    // leftover half pixel would swallow the button forever.
    return box.scrollLeft <= 1 ? 0 : -Math.min(step, box.scrollLeft);
  }
  const remaining = overflow - box.scrollLeft;
  return remaining <= 1 ? 0 : Math.min(step, remaining);
}
