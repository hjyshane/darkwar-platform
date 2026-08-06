// What each toolbar button does to the text.
//
// Pure: takes the body, the selection, and an action; returns the new body and
// where the selection should end up. The component only reads the textarea and
// writes back — which is what makes this testable, and the fiddly parts are
// exactly the ones worth testing.
//
// The fiddly parts, all of which are wrong in most hand-rolled toolbars:
//
//   Pressing bold with nothing selected should leave the caret BETWEEN the
//   markers, ready to type. Leaving it after them means typing `**bold**text`.
//
//   Pressing bold on already-bold text should UNWRAP it. A button that only ever
//   adds markers turns `**a**` into `****a****`, which renders as literal
//   asterisks and looks like the button is broken.
//
//   A line prefix (bullet, heading, indent) applies to every line the selection
//   touches, and toggles off if they all already have it.

export type InlineAction = 'bold' | 'italic' | 'code' | 'link';
export type LineAction = 'bullet' | 'indent' | 'outdent' | 'heading2' | 'heading3';
export type MarkupAction = InlineAction | LineAction;

export interface Selection {
  start: number;
  end: number;
}

export interface Applied {
  body: string;
  selection: Selection;
}

const WRAPPERS: Record<InlineAction, string> = {
  bold: '**',
  italic: '*',
  code: '`',
  // Handled separately — a link is not a symmetric wrapper.
  link: '',
};

/** Wrap or unwrap the selection. */
function applyInline(body: string, selection: Selection, action: InlineAction): Applied {
  const chosen = body.slice(selection.start, selection.end);

  if (action === 'link') {
    // The URL placeholder is selected afterwards, so the next keystroke replaces
    // it. Somebody who pressed the button wants to type an address, not hunt for
    // the brackets.
    const text = chosen === '' ? 'text' : chosen;
    const inserted = `[${text}](https://)`;
    const urlStart = selection.start + text.length + 3;
    return {
      body: body.slice(0, selection.start) + inserted + body.slice(selection.end),
      selection: { start: urlStart, end: urlStart + 'https://'.length },
    };
  }

  const marker = WRAPPERS[action];

  // Already wrapped? Take it off. Checked on the SELECTION first, then on the
  // text just outside it, because both are things a reader would call "bold" when
  // they press the button again.
  if (chosen.length >= marker.length * 2 && chosen.startsWith(marker) && chosen.endsWith(marker)) {
    const inner = chosen.slice(marker.length, chosen.length - marker.length);
    return {
      body: body.slice(0, selection.start) + inner + body.slice(selection.end),
      selection: { start: selection.start, end: selection.start + inner.length },
    };
  }
  const before = body.slice(selection.start - marker.length, selection.start);
  const after = body.slice(selection.end, selection.end + marker.length);
  if (chosen !== '' && before === marker && after === marker) {
    return {
      body:
        body.slice(0, selection.start - marker.length) +
        chosen +
        body.slice(selection.end + marker.length),
      selection: {
        start: selection.start - marker.length,
        end: selection.end - marker.length,
      },
    };
  }

  const inserted = marker + chosen + marker;
  return {
    body: body.slice(0, selection.start) + inserted + body.slice(selection.end),
    selection:
      chosen === ''
        ? // Between the markers, ready to type.
          { start: selection.start + marker.length, end: selection.start + marker.length }
        : { start: selection.start + marker.length, end: selection.end + marker.length },
  };
}

/** The lines the selection touches, as a range of character offsets. */
function lineRange(body: string, selection: Selection): Selection {
  const start = body.lastIndexOf('\n', selection.start - 1) + 1;
  const nextBreak = body.indexOf('\n', selection.end);
  return { start, end: nextBreak === -1 ? body.length : nextBreak };
}

const BULLET = /^( *)([-*+])\s+/;
const HEADING = /^(#{2,3})\s+/;

function applyLine(body: string, selection: Selection, action: LineAction): Applied {
  const range = lineRange(body, selection);
  const lines = body.slice(range.start, range.end).split('\n');

  let next: string[];
  switch (action) {
    case 'bullet': {
      // Off if every line already has one. A button that only adds would turn a
      // list back into `- - a`.
      const allBulleted = lines.every((line) => BULLET.test(line));
      next = lines.map((line) =>
        allBulleted
          ? line.replace(BULLET, '$1')
          : `${line.match(/^ */)?.[0] ?? ''}- ${line.trimStart()}`,
      );
      break;
    }
    case 'indent':
      // Two spaces, which is what the parser reads as a sub-bullet and what
      // Discord reads the same way.
      next = lines.map((line) => `  ${line}`);
      break;
    case 'outdent':
      next = lines.map((line) => line.replace(/^ {1,2}/, ''));
      break;
    default: {
      const hashes = action === 'heading2' ? '##' : '###';
      const already = lines.every((line) => line.startsWith(`${hashes} `));
      next = lines.map((line) =>
        already ? line.replace(HEADING, '') : `${hashes} ${line.replace(HEADING, '')}`,
      );
    }
  }

  const replaced = next.join('\n');
  return {
    body: body.slice(0, range.start) + replaced + body.slice(range.end),
    // The whole affected block stays selected, so pressing the button twice
    // toggles the same lines rather than a drifting subset.
    selection: { start: range.start, end: range.start + replaced.length },
  };
}

export function applyMarkup(body: string, selection: Selection, action: MarkupAction): Applied {
  return action === 'bold' || action === 'italic' || action === 'code' || action === 'link'
    ? applyInline(body, selection, action)
    : applyLine(body, selection, action);
}
