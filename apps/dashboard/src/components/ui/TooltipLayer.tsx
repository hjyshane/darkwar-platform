import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeTip } from './tooltipLogic';

/** One styled tooltip for every element that carries a `title`.
 *
 * About a hundred call sites already say `title="..."`, and the browser's own
 * tooltip is slow, unstyled, unreadable in the dark theme and never appears on
 * touch. Rather than rewrite each one into a wrapper component, this listens once
 * at the document and takes over: while the pointer is on an element (or keyboard
 * focus is), its `title` is parked in `data-tip`, which stops the native tooltip,
 * and ours is drawn instead. Leaving puts the attribute back exactly as it was,
 * so nothing at rest has changed for assistive tech or for a test that reads
 * `title`.
 *
 * An element with a title and NO text of its own (an icon button) takes its
 * name from that title. While the title is parked it would lose it, so the name
 * is carried as `aria-label` for the same stretch and removed again after.
 *
 * Mouse, pen and keyboard focus only. Touch never had a hover tooltip, and one
 * that pops up on a tap would sit on top of whatever the tap was for. */
const SHOW_DELAY_MS = 350;

interface Shown {
  text: string;
  anchor: { left: number; top: number; width: number; height: number };
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const parked = useRef<{
    el: Element;
    title: string;
    labelled: boolean;
  } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    function restore() {
      window.clearTimeout(timer.current);
      const held = parked.current;
      if (held !== null) {
        held.el.setAttribute('title', held.title);
        if (held.labelled) {
          held.el.removeAttribute('aria-label');
        }
        held.el.removeAttribute('data-tip');
        parked.current = null;
      }
      setShown(null);
      setAt(null);
    }

    function reveal(el: Element, delay: number) {
      const title = el.getAttribute('title');
      if (title === null || title.trim() === '' || el.closest('[data-tooltip-layer]') !== null) {
        return;
      }
      if (parked.current?.el === el) {
        return;
      }
      restore();
      const labelled =
        !el.hasAttribute('aria-label') &&
        !el.hasAttribute('aria-labelledby') &&
        !el.textContent?.trim();
      el.setAttribute('data-tip', title);
      el.removeAttribute('title');
      if (labelled) {
        el.setAttribute('aria-label', title);
      }
      parked.current = { el, title, labelled };
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setShown({
          text: title,
          anchor: { left: r.left, top: r.top, width: r.width, height: r.height },
        });
      }, delay);
    }

    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) {
        return;
      }
      const el = event.target.closest('[title]');
      if (el !== null) {
        reveal(el, SHOW_DELAY_MS);
      }
    };
    const out = (event: PointerEvent) => {
      const held = parked.current?.el;
      if (
        held !== undefined &&
        !(event.relatedTarget instanceof Node && held.contains(event.relatedTarget))
      ) {
        restore();
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) {
        const el = event.target.closest('[title]');
        if (el !== null) {
          reveal(el, 0);
        }
      }
    };
    const away = () => restore();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        restore();
      }
    };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', away);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    return () => {
      restore();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', away);
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
    };
  }, []);

  // Measured after it is in the DOM, because where it goes depends on how big
  // the text made it.
  useLayoutEffect(() => {
    if (shown === null || tip.current === null) {
      return;
    }
    const size = tip.current.getBoundingClientRect();
    const { left, top } = placeTip(
      shown.anchor,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setAt({ left, top });
  }, [shown]);

  if (shown === null) {
    return null;
  }
  return createPortal(
    <div
      ref={tip}
      className="tooltip"
      data-tooltip-layer=""
      role="tooltip"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        visibility: at === null ? 'hidden' : 'visible',
      }}
    >
      {shown.text}
    </div>,
    document.body,
  );
}
