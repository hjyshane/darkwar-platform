import { useEffect } from 'react';
import { sidewaysStep } from './tableScroll';

/** Let a mouse's sideways buttons scroll whichever table is under the cursor.
 *
 * ONE DELEGATED LISTENER, NOT ONE PER TABLE. It finds the scroller with
 * `closest('.table-wrap')`, so every table gets this — including the ones that
 * still hand-write their markup and the ones nobody has written yet. Registering
 * per table would have meant editing twenty components and forgetting the
 * twenty-first.
 *
 * Chrome decides to navigate on `mousedown` for these buttons, so that is where
 * it has to be refused; `auxclick` is refused too, because a press we consumed
 * must not still produce a click somewhere else.
 */
export function useSidewaysMouse(): void {
  useEffect(() => {
    // Set on a press we consumed, read by the auxclick that follows it. A plain
    // variable rather than state: nothing renders from it, and a re-render
    // between the two events would lose it.
    let consumed = false;

    function onMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const scroller = target.closest('.table-wrap');
      if (scroller === null) {
        return;
      }
      const step = sidewaysStep(event.button, scroller);
      if (step === 0) {
        // Nothing to scroll — so this press is a Back or a Forward, and it is
        // not ours to take.
        consumed = false;
        return;
      }
      scroller.scrollLeft += step;
      consumed = true;
      event.preventDefault();
    }

    function onAuxClick(event: MouseEvent) {
      if (consumed) {
        event.preventDefault();
        consumed = false;
      }
    }

    // Capture, so a table that stops propagation on its own rows cannot stop
    // this from seeing the press.
    document.addEventListener('mousedown', onMouseDown, { capture: true });
    document.addEventListener('auxclick', onAuxClick, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.removeEventListener('auxclick', onAuxClick, { capture: true });
    };
  }, []);
}
