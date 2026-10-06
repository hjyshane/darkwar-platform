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
 * Activation follows focus, as it does in a native tab strip: the panels here
 * are cheap to switch, so there is nothing to confirm. `value` that matches no
 * item (a tab that vanished) leaves the first enabled one reachable.
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
}: {
  items: readonly TabItem<T>[];
  value: T | null | undefined;
  onChange: (id: T) => void;
  /** Accessible name of the whole bar. */
  label: string;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const reachable = enabled.some((item) => item.id === value) ? value : enabled[0]?.id;

  function onKeyDown(event: KeyboardEvent, id: T) {
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
    onChange(next.id);
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
