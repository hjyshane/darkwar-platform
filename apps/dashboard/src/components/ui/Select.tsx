import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { edgeIndex, moveActive, optionsFromChildren, typeaheadIndex } from './selectLogic';

/** A dropdown that replaces the browser's own, whose popup is drawn by the OS
 * and cannot take the theme.
 *
 * Call sites migrate by renaming the tag: it reads `<option>` children like a
 * `<select>`. The one difference is `onChange`, which receives the chosen VALUE
 * rather than an event — there is no event to hand over, and a fake one is the
 * kind of thing that works until somebody reads `event.target.name`.
 *
 * ARIA "select-only combobox": the trigger is a button that keeps focus the
 * whole time and points at the highlighted option with `aria-activedescendant`,
 * so a screen reader hears the same thing a native select would say. */
export interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** Room the popup wants below the trigger before it flips upward. */
const POPUP_ROOM = 240;
/** How long a pause ends a typeahead word. */
const TYPEAHEAD_MS = 600;

export function Select({
  value,
  onChange,
  children,
  id,
  className,
  title,
  disabled = false,
  ...aria
}: SelectProps) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const selected = options.findIndex((option) => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const buffer = useRef({ text: '', at: 0 });
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

  function show() {
    if (disabled || options.length === 0) {
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (rect !== undefined) {
      const below = window.innerHeight - rect.bottom;
      setFlip(below < POPUP_ROOM && rect.top > below);
    }
    setActive(selected >= 0 ? selected : Math.max(edgeIndex(options, 'first'), 0));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option === undefined || option.disabled) {
      return;
    }
    setOpen(false);
    if (option.value !== String(value)) {
      onChange(option.value);
    }
    trigger.current?.focus();
  }

  // A press outside closes it. Listening on mousedown, not click, so it closes
  // before whatever was pressed gets its own turn.
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keep the highlighted option in view as the arrows move through a long list.
  useEffect(() => {
    if (open) {
      document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  function typeahead(char: string) {
    const now = Date.now();
    const text = now - buffer.current.at > TYPEAHEAD_MS ? char : buffer.current.text + char;
    buffer.current = { text, at: now };
    const hit = typeaheadIndex(options, open ? active : selected, text);
    if (hit < 0) {
      return;
    }
    if (open) {
      setActive(hit);
    } else {
      choose(hit);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) {
      return;
    }
    const { key } = event;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        show();
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        typeahead(key);
      }
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => moveActive(options, i, 1));
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => moveActive(options, i, -1));
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault();
      setActive(edgeIndex(options, key === 'Home' ? 'first' : 'last'));
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (key === 'Tab') {
      setOpen(false);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead(key);
    }
  }

  const current = options[selected];
  return (
    <span ref={root} className={`select${open ? ' select-open' : ''}`}>
      <button
        ref={trigger}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`select-trigger${className ? ` ${className}` : ''}`}
        disabled={disabled}
        id={id}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        role="combobox"
        title={title}
        type="button"
        {...aria}
      >
        <span className="select-value">{current?.label ?? '—'}</span>
      </button>
      {open && (
        <ul
          className={`select-pop${flip ? ' select-pop-up' : ''}`}
          id={listId}
          // The trigger keeps focus; a press on the list must not take it.
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
          tabIndex={-1}
        >
          {options.map((option, i) => (
            <li
              key={`${option.value}-${i}`}
              aria-disabled={option.disabled || undefined}
              aria-selected={i === selected}
              className={`select-option${i === active ? ' select-option-active' : ''}${i === selected ? ' select-option-selected' : ''}`}
              id={optionId(i)}
              onClick={() => choose(i)}
              onMouseMove={() => i !== active && !option.disabled && setActive(i)}
              role="option"
            >
              <span>{option.label}</span>
              {i === selected && (
                <span aria-hidden="true" className="select-check">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
