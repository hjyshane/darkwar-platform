// A deliberately small markup subset, parsed into data rather than HTML.
//
// WHY THIS EXISTS AND WHAT IT REFUSES TO DO.
//
// Notices and guides are written by people and read by 94 others. Rendering
// their text as HTML would make this the one place in the app where a person can
// put script into everyone else's page — so nothing here ever produces HTML.
// `parse` returns a tree of plain objects; the component that renders it builds
// React elements. `dangerouslySetInnerHTML` appears nowhere, which means there is
// no injection path to get wrong rather than a sanitizer to keep correct.
//
// A `<script>` in the source is therefore not "stripped" — it is text, and it
// renders as the characters a person typed. That is the whole design.
//
// The subset is chosen to match what Discord already understands, because the
// same body gets published there: bold, italic, inline code, links, bullets and
// headings all survive the trip. Tables and images do not, and are left out.

/** Where a link may point.
 *
 * http and https only. `javascript:` is the obvious one, but `data:` is the one
 * people forget — `data:text/html,<script>` in an href runs on click. An
 * allowlist rather than a blocklist, so a scheme nobody has thought of yet is
 * refused by default. */
const SAFE_SCHEMES = ['http://', 'https://'];

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/** One bullet, and how deeply it is indented.
 *
 * Two levels, not arbitrary depth. Two is what a tips board needs — a step and
 * its caveat — and Discord renders a two-space indent as a sub-bullet, so both
 * levels survive being published. A third level would render flat there and the
 * board would disagree with the channel. */
export interface ListItem {
  content: Inline[];
  depth: 0 | 1;
}

export type Block =
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'heading'; level: 2 | 3; content: Inline[] }
  | { kind: 'list'; items: ListItem[] };

/** Whether a link target is one we will render as a link at all. */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  if (!SAFE_SCHEMES.some((scheme) => trimmed.startsWith(scheme))) {
    return false;
  }
  // An unclosed bracket means the pattern below truncated the URL: it stops at
  // the first `)`, so `https://example.com/a(b)` is captured as
  // `https://example.com/a(b`. Linking that sends the reader somewhere the author
  // did not write — a quieter failure than refusing, and a worse one. Since the
  // captured href can never contain `)`, any `(` in it proves the truncation.
  return !trimmed.includes('(');
}

// One pattern, alternatives ordered so the longest marker wins: `**` has to be
// tried before `*`, or bold parses as two italics wrapping nothing.
//
// Non-greedy bodies, and no nesting. Nesting means a real parser, and "bold
// inside a link" is not worth one — the subset is for emphasis in a paragraph,
// not for typesetting.
//
// The href run is `[^)\s]+`, so a URL containing a closing bracket ends the match
// early and the whole thing stays text. Standard markdown has the same limit
// without escaping, and the failure is in the safe direction: an unparsed link
// renders as the characters typed rather than as a link to somewhere else.
const INLINE = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|\[([^\]]+)\]\(([^)\s]+)\))/;

/** Split one line into runs of text and marked-up spans. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let rest = line;

  while (rest !== '') {
    const match = INLINE.exec(rest);
    if (match === null || match.index === undefined) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      out.push({ kind: 'text', text: rest.slice(0, match.index) });
    }
    const [whole, , bold, italic, code, linkText, href] = match;
    if (bold !== undefined) {
      out.push({ kind: 'bold', text: bold });
    } else if (italic !== undefined) {
      out.push({ kind: 'italic', text: italic });
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code });
    } else if (linkText !== undefined && href !== undefined) {
      // An unsafe scheme keeps its source text rather than vanishing. Silently
      // dropping it would leave the author wondering where their link went, and
      // leave a reader with a sentence missing a word.
      out.push(
        isSafeHref(href)
          ? { kind: 'link', text: linkText, href: href.trim() }
          : { kind: 'text', text: whole },
      );
    }
    rest = rest.slice(match.index + whole.length);
  }

  // Empty input is one empty text run rather than nothing, so a caller can
  // always render `content` without checking for the empty case.
  return out.length > 0 ? out : [{ kind: 'text', text: '' }];
}

/** Turn a body into blocks.
 *
 * Line-based, because the alternative is a real block parser and the subset does
 * not need one. A blank line ends a paragraph; `## ` and `### ` are headings;
 * consecutive `- ` lines are one list. Anything else is paragraph text, and a
 * single newline inside a paragraph is kept as a line break — people writing
 * notices use newlines to mean newlines.
 */
export function parse(body: string): Block[] {
  const blocks: Block[] = [];
  // Windows line endings arrive from a textarea on Windows, and a stray \r would
  // otherwise end up inside the rendered text.
  const lines = body.replaceAll('\r\n', '\n').split('\n');

  let paragraph: string[] = [];
  let items: ListItem[] = [];

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  }
  function flushList(): void {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    // `-`, `*` and `+` all mean a bullet, because all three are what people
    // type. The leading run of spaces is captured, not skipped: two or more make
    // it a sub-bullet, which is the same rule Discord applies when the guide is
    // published there.
    const bullet = /^( *)[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet?.[2] !== undefined) {
      flushParagraph();
      items.push({
        content: parseInline(bullet[2]),
        // Clamped at one. Deeper indentation is treated as one level rather than
        // ignored, so a reader who indented four spaces still gets a sub-bullet
        // instead of their intent being dropped.
        depth: (bullet[1] ?? '').length >= 2 ? 1 : 0,
      });
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    const hashes = heading?.[1];
    if (heading?.[2] !== undefined && hashes !== undefined) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: 'heading',
        // h2 is the section heading on every screen, so a body starts at h3 at
        // the shallowest — a heading that outranks the page's own is a document
        // outline nobody can navigate.
        level: hashes.length === 2 ? 2 : 3,
        content: parseInline(heading[2]),
      });
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}
