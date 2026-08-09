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

/** Wrap the selection in a colour, or take the colour off.
 *
 * Not a `MarkupAction` for the same reason `insertImage` is not: the action
 * carries a value the buttons do not. Same three behaviours as the symmetric
 * wrappers, because a colour button that only ever adds `[…]{red}` produces
 * `[[a]{red}]{red}` on the second press.
 *
 * With nothing selected it inserts a placeholder and selects THAT, rather than
 * leaving the caret between markers: `[]{red}` with the caret in the brackets
 * looks the same as a caret anywhere else, and the writer cannot see what they
 * are about to affect.
 */
export function applyColour(body: string, selection: Selection, colour: string): Applied {
  const chosen = body.slice(selection.start, selection.end);
  const wrapped = /^\[([\s\S]+)\]\{[a-z]+\}$/.exec(chosen);
  const inner = wrapped?.[1];
  if (inner !== undefined) {
    return {
      body: body.slice(0, selection.start) + inner + body.slice(selection.end),
      selection: { start: selection.start, end: selection.start + inner.length },
    };
  }
  const text = chosen === '' ? 'text' : chosen;
  return {
    body: `${body.slice(0, selection.start)}[${text}]{${colour}}${body.slice(selection.end)}`,
    selection: { start: selection.start + 1, end: selection.start + 1 + text.length },
  };
}

/** Mark the picture the caret is on as full width, or put it back.
 *
 * Line-based, because that is what an image is in this subset: `![alt](url)`
 * alone on its line, with `{wide}` after it when the author wants the column's
 * full width from the moment the page opens.
 *
 * The caret does not have to be inside the markup, only somewhere on the line —
 * pressing the button with the cursor at the end of an image line is what
 * people will do, and refusing that would read as the button being broken. If
 * the line is not an image, nothing happens: silently doing something else to
 * a paragraph would be worse than doing nothing.
 */
const IMAGE_LINE = /^(!\[[^\]]*\]\([^)\s]+\))(\{wide\})?$/;

export function toggleImageWidth(body: string, selection: Selection): Applied {
  const lineStart = body.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
  const lineEndRaw = body.indexOf('\n', selection.start);
  const lineEnd = lineEndRaw === -1 ? body.length : lineEndRaw;
  const line = body.slice(lineStart, lineEnd);
  const match = IMAGE_LINE.exec(line.trim());
  const image = match?.[1];
  if (image === undefined) {
    return { body, selection };
  }
  const next = match?.[2] === undefined ? `${image}{wide}` : image;
  return {
    body: body.slice(0, lineStart) + next + body.slice(lineEnd),
    selection: { start: lineStart + next.length, end: lineStart + next.length },
  };
}

/** Drop a character at the caret. Replaces the selection, like typing does.
 *
 * Used by the emoji palette, and nothing about it is emoji-specific — it is
 * "type this for me", which is what pressing a picture of a face means.
 */
export function insertText(body: string, selection: Selection, text: string): Applied {
  const at = selection.start + text.length;
  return {
    body: body.slice(0, selection.start) + text + body.slice(selection.end),
    selection: { start: at, end: at },
  };
}

/** Put an uploaded image into the body, on a line of its own.
 *
 * Not a `MarkupAction`, because it needs a URL and the actions take none — the
 * caller has just uploaded a file and knows where it landed.
 *
 * ON ITS OWN LINE, because `parse` only treats `![alt](url)` as an image when the
 * line holds nothing else. Inserting at a caret mid-sentence would otherwise
 * produce markup that renders as literal text, which looks like the upload failed.
 * Blank lines around it so it is its own block whatever it was dropped between.
 *
 * The ALT TEXT is left selected. An image with no alt is invisible to anybody using
 * a screen reader, and the one moment somebody might actually type a description is
 * the moment the cursor is already sitting on it.
 */
export function insertImage(
  body: string,
  selection: Selection,
  url: string,
  alt = 'describe the picture',
): Applied {
  const before = body.slice(0, selection.start);
  const after = body.slice(selection.end);
  // Only add the separators that are missing: a body already ending in a blank
  // line does not need two more.
  const lead =
    before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail =
    after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const altStart = before.length + lead.length + 2;
  return {
    body: `${before}${lead}![${alt}](${url})${tail}${after}`,
    selection: { start: altStart, end: altStart + alt.length },
  };
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
