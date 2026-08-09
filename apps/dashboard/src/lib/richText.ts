import { SUPABASE_URL } from './env';

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
// headings all survive the trip. Tables are left out. Images arrive as a bare URL
// in the published text, which Discord unfurls into a preview — so they survive
// too, by a different route than the rest.

/** Where a link may point.
 *
 * http and https only. `javascript:` is the obvious one, but `data:` is the one
 * people forget — `data:text/html,<script>` in an href runs on click. An
 * allowlist rather than a blocklist, so a scheme nobody has thought of yet is
 * refused by default. */
const SAFE_SCHEMES = ['http://', 'https://'];

/** Where an IMAGE may point, which is a far shorter list: our own bucket.
 *
 * An `<img src>` is fetched by every reader's browser the moment the page opens,
 * with no click. Pointed at somebody else's host, that hands the host a log line
 * per reader — address, time, user agent — which is a serviceable way to count who
 * has opened a guide. This dashboard deliberately cannot answer that question:
 * `post_reads` is private even to admins (0079), and an image tag must not become
 * the back door to it.
 *
 * So an image comes from `post-images` (0082) or it is not rendered as an image. A
 * picture hosted elsewhere still works as a LINK, where the reader chooses to go —
 * which is the whole difference.
 */
const IMAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/post-images/`;

/** The colours a writer may pick, and nothing else.
 *
 * An allowlist of NAMES, not colours: the body would otherwise carry
 * `#ff0000`, which is unreadable on one of the two themes and impossible to
 * change later. Each name resolves to a CSS custom property, so a red in dark
 * mode is the dark theme's red.
 *
 * `mark` is the highlighter — a background rather than a text colour, which is
 * what people reach for when they mean "read this bit".
 */
export const COLOUR_NAMES = ['red', 'orange', 'green', 'blue', 'purple', 'grey', 'mark'] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];

export function isColourName(name: string): name is ColourName {
  return (COLOUR_NAMES as readonly string[]).includes(name);
}

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'colour'; text: string; colour: ColourName };

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
  | { kind: 'list'; items: ListItem[] }
  // A BLOCK, not an inline. An image halfway through a sentence is not what a
  // guide wants, and a block is the shape that can be given a caption and a width
  // without fighting the line box around it.
  // `fill` is the AUTHOR's choice of width, made once, rather than a decision
  // pushed onto every reader. A map or a comparison table is unreadable capped;
  // a phone screenshot of a chat is not. The reader can still collapse it.
  | { kind: 'image'; src: string; alt: string; fill: boolean };

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

/** Whether an image source is one we will render as an image.
 *
 * Our own public bucket and nothing else — see IMAGE_PREFIX for why. Compared
 * case-sensitively, because a path is case-sensitive and lowercasing first would
 * accept a host that merely looks like ours after folding.
 */
export function isSafeImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed.startsWith(IMAGE_PREFIX)) {
    return false;
  }
  // Same truncation proof as a link href: the pattern stops at the first `)`, so a
  // `(` surviving in the captured URL means the real one was cut short. And no
  // `..` — a public object path has no business walking upwards, and a prefix
  // check alone would accept `…/post-images/../another-bucket/x`.
  return !trimmed.includes('(') && !trimmed.includes('..');
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
// Colour deliberately borrows the link's shape — `[text]{red}` beside
// `[text](url)` — because it is the same idea (a span with an attribute) and a
// second bracket idiom would be one more thing to remember. Braces cannot be
// confused with a link's parentheses, and the name is matched loosely here so
// an unknown colour falls through to plain text below rather than silently
// eating the brackets.
const INLINE =
  /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|\[([^\]]+)\]\(([^)\s]+)\)|\[([^\]]+)\]\{([a-z]+)\})/;

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
    const [whole, , bold, italic, code, linkText, href, colourText, colourName] = match;
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
    } else if (colourText !== undefined && colourName !== undefined) {
      // Same rule as an unsafe href: a colour nobody defined keeps its source
      // text rather than vanishing, so the author sees what they typed instead
      // of a sentence with a hole in it.
      out.push(
        isColourName(colourName)
          ? { kind: 'colour', text: colourText, colour: colourName }
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
    // An image, alone on its line. Only alone: `![a](x) and text` stays a
    // paragraph, because half a line of prose wrapped around a block image is a
    // layout question the subset does not answer.
    //
    // An unsafe source falls through to the paragraph below and renders as the
    // characters typed — same rule as an unsafe link href. The author sees their
    // markup instead of wondering where the picture went.
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)(\{wide\})?$/.exec(trimmed.trim());
    const src = image?.[2];
    if (src !== undefined && isSafeImageSrc(src)) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: 'image',
        src: src.trim(),
        alt: (image?.[1] ?? '').trim(),
        fill: image?.[3] !== undefined,
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
