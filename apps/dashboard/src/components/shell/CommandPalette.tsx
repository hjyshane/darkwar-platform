import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavItem } from '../../lib/shellNav';
import { Icon } from './icons';

/** Ctrl+K: type a screen's name and go there.
 *
 * It finds SCREENS, not players or alliances; the placeholder says so, because a
 * search box that promises more than it does is worse than none. */
export function CommandPalette({
  items,
  open,
  onClose,
}: {
  items: readonly NavItem[];
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ''
      ? [...items]
      : items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const go = (item: NavItem | undefined) => {
    if (item === undefined) return;
    window.location.hash = item.href;
    onClose();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <dialog aria-label="Go to a screen" className="palette" open>
        <div className="palette-field">
          <Icon name="search" />
          <input
            aria-controls="palette-list"
            aria-label="Go to a screen"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, shown.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') go(shown[active]);
            }}
            placeholder="Go to a screen"
            ref={input}
            value={query}
          />
        </div>
        <ul className="palette-list" id="palette-list">
          {shown.map((item, index) => (
            <li key={item.key}>
              <a
                aria-current={index === active ? 'true' : undefined}
                className="palette-row"
                href={item.href}
                onClick={onClose}
                onMouseEnter={() => setActive(index)}
              >
                <Icon name={item.icon} />
                {item.label}
              </a>
            </li>
          ))}
          {shown.length === 0 && <li className="palette-empty">No screen by that name.</li>}
        </ul>
      </dialog>
    </div>
  );
}
