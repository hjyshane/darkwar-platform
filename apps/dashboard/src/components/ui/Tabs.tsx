import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export interface TabItem<T extends string | number> {
  id: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** A tab bar: the ARIA tabs pattern, which the hand-copied ones were half of.
 *
 * Every copy had `role="tablist"`, `role="tab"` and `aria-selected` right, and
 * none had the keyboard half: the selected tab is the only one in the tab order
 * (roving tabindex), and the arrow keys, Home and End move between them. Without
 * it a bar of eight tabs is eight stops on the way through the page.
 *
 * Arrows MOVE FOCUS; Enter, Space or a click selects (the ARIA "manual
 * activation" variant). Following focus looks nicer but several of these bars
 * do real work on select — the map clears its search and HQ filters, the stock
 * panel clears its filter, the hive and arena swap data — and arrowing across
 * eight tabs would run all of it eight times. `activation="auto"` is there for a
 * bar where selecting is free. `value` that matches no item (a tab that
 * vanished) leaves the first enabled one reachable.
 *
 * Styling is the global `[role="tablist"]` / `[role="tab"]` rules, so a bar looks
 * the same whether it came through here or not; `className` is for the few that
 * add a modifier (`planner-tabs`, `row`). */
export function Tabs<T extends string | number>({
  items,
  value,
  onChange,
  label,
  className,
  activation = 'manual',
}: {
  items: readonly TabItem<T>[];
  value: T | null | undefined;
  onChange: (id: T) => void;
  /** Accessible name of the whole bar. */
  label: string;
  className?: string;
  /** `manual` (default): arrows move focus, Enter/Space selects. `auto`: selecting
   * follows focus. */
  activation?: 'manual' | 'auto';
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const reachable = enabled.some((item) => item.id === value) ? value : enabled[0]?.id;

  function onKeyDown(event: KeyboardEvent, id: T) {
    // Alt+Left/Right is the browser's Back/Forward; leave modified keys alone.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const at = enabled.findIndex((item) => item.id === id);
    let to = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      to = (at + 1) % enabled.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      to = (at - 1 + enabled.length) % enabled.length;
    } else if (event.key === 'Home') {
      to = 0;
    } else if (event.key === 'End') {
      to = enabled.length - 1;
    }
    const next = enabled[to];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    refs.current.get(next.id)?.focus();
    if (activation === 'auto') {
      onChange(next.id);
    }
  }

  return (
    <div aria-label={label} className={className} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          ref={(node) => {
            if (node === null) {
              refs.current.delete(item.id);
            } else {
              refs.current.set(item.id, node);
            }
          }}
          aria-selected={item.id === value}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => onKeyDown(event, item.id)}
          role="tab"
          tabIndex={item.id === reachable ? 0 : -1}
          title={item.title}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
