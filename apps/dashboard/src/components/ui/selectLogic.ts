import { Children, Fragment, type ReactElement, type ReactNode, isValidElement } from 'react';

/** One choice in a Select. `text` is the plain string used for typeahead and for
 * the trigger's accessible value; `label` is what is drawn. */
export interface SelectOption {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return '';
}

/** Read `<option>` children the way a native `<select>` does, so a call site
 * migrates by renaming the tag. A fragment is looked through; `<optgroup>` is
 * not supported (nothing here uses one) and its options are skipped. */
export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) {
      continue;
    }
    if (child.type === Fragment) {
      out.push(
        ...optionsFromChildren((child as ReactElement<{ children?: ReactNode }>).props.children),
      );
      continue;
    }
    if (child.type !== 'option') {
      continue;
    }
    const props = (
      child as ReactElement<{
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      }>
    ).props;
    const text = textOf(props.children);
    out.push({
      value: props.value === undefined ? text : String(props.value),
      label: props.children,
      text,
      disabled: props.disabled === true,
    });
  }
  return out;
}

/** Next enabled option from `from`, stepping `delta` (+1/-1), stopping at the
 * ends rather than wrapping — a list you can fall off the bottom of is harder to
 * reason about than one with an end. Returns `from` when nothing is reachable. */
export function moveActive(options: readonly SelectOption[], from: number, delta: 1 | -1): number {
  let i = from + delta;
  while (i >= 0 && i < options.length) {
    if (!options[i]?.disabled) {
      return i;
    }
    i += delta;
  }
  return from;
}

/** First or last enabled option. -1 when every option is disabled. */
export function edgeIndex(options: readonly SelectOption[], which: 'first' | 'last'): number {
  const order = options.map((_, i) => i);
  if (which === 'last') {
    order.reverse();
  }
  return order.find((i) => !options[i]?.disabled) ?? -1;
}

/** Typeahead: the next enabled option whose text starts with `buffer`, searching
 * from just after `from` and wrapping, so pressing the same letter again cycles
 * through the matches. -1 when nothing matches. */
export function typeaheadIndex(
  options: readonly SelectOption[],
  from: number,
  buffer: string,
): number {
  const needle = buffer.toLowerCase();
  if (needle === '') {
    return -1;
  }
  // A repeated single letter cycles; a longer buffer matches from the current one.
  const cycling = needle.length > 1 && [...needle].every((c) => c === needle[0]);
  const query = cycling ? (needle[0] ?? needle) : needle;
  const start = query.length === 1 || cycling ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < options.length; step++) {
    const i = (start + step) % options.length;
    const option = options[i];
    if (option !== undefined && !option.disabled && option.text.toLowerCase().startsWith(query)) {
      return i;
    }
  }
  return -1;
}
