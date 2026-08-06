// The parser is where the security lives, so most of this file is about what it
// REFUSES. Nothing here produces HTML — `parse` returns plain objects and the
// component builds React elements — so these tests assert the shape of that data
// rather than a rendered string.
import { describe, expect, test } from 'vitest';
import { isSafeHref, parse, parseInline } from '../src/lib/richText';

// The local stack's URL, which is what `lib/env` falls back to under vitest.
const OURS = 'http://127.0.0.1:54321/storage/v1/object/public/post-images';

describe('link schemes', () => {
  test('http and https are allowed', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('  HTTPS://Example.com  ')).toBe(true);
  });

  // javascript: is the one everybody checks for. `data:` is the one people
  // forget — `data:text/html,<script>…` in an href runs when clicked.
  test('javascript and data are refused', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  // An allowlist, so a scheme nobody has thought of is refused by default rather
  // than waiting to be added to a blocklist.
  test('anything else is refused, including schemes that look harmless', () => {
    for (const href of ['mailto:a@b.c', 'file:///etc/passwd', 'vbscript:x', '//example.com', '']) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  // Not dropped: the author would wonder where their link went, and the reader
  // would get a sentence with a word missing.
  //
  // Asserted as a property rather than an exact split. The href pattern stops at
  // the first `)`, so `javascript:alert(1)` truncates and the segmentation is
  // untidy — but what matters is that no `link` node comes out and every
  // character the author typed is still on screen. Pinning the exact runs would
  // be pinning an implementation detail of the regex.
  test('an unsafe link produces no link, and loses no text', () => {
    const runs = parseInline('see [this](javascript:alert(1)) now');
    expect(runs.some((run) => run.kind === 'link')).toBe(false);
    expect(runs.map((run) => run.text).join('')).toBe('see [this](javascript:alert(1)) now');
  });

  // The same truncation means a legitimate URL with a bracket in it is not
  // linked either. Safe, and worth knowing: it renders as text rather than
  // silently pointing somewhere else.
  test('a url containing a bracket is left as text rather than half-linked', () => {
    const runs = parseInline('[wiki](https://example.com/a(b))');
    expect(runs.some((run) => run.kind === 'link')).toBe(false);
  });
});

describe('markup is never HTML', () => {
  // The point of the whole module. A tag in the source is TEXT — not stripped,
  // not escaped after the fact, simply never markup.
  test('a script tag is text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ]);
  });

  test('an img with an onerror is text', () => {
    const blocks = parse('<img src=x onerror=alert(1)>');
    expect(blocks).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ]);
  });
});

describe('inline', () => {
  test('bold, italic and code', () => {
    expect(parseInline('a **b** c *d* e `f`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' e ' },
      { kind: 'code', text: 'f' },
    ]);
  });

  // `**` has to be tried before `*`, or bold parses as two italics wrapping
  // nothing and the asterisks end up on screen.
  test('bold wins over italic', () => {
    expect(parseInline('**both**')).toEqual([{ kind: 'bold', text: 'both' }]);
  });

  test('a link keeps its text and href apart', () => {
    expect(parseInline('[the wiki](https://example.com/a)')).toEqual([
      { kind: 'link', text: 'the wiki', href: 'https://example.com/a' },
    ]);
  });

  test('an unmatched marker is just a character', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
    expect(parseInline('a ** b')).toEqual([{ kind: 'text', text: 'a ** b' }]);
  });

  // So a caller can render `content` without special-casing the empty body.
  test('empty input is one empty run', () => {
    expect(parseInline('')).toEqual([{ kind: 'text', text: '' }]);
  });
});

describe('blocks', () => {
  test('a blank line ends a paragraph', () => {
    const blocks = parse('one\n\ntwo');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });

  // People writing notices use newlines to mean newlines. Collapsing them the way
  // markdown does would reflow every announcement written so far.
  test('a single newline stays inside the paragraph', () => {
    expect(parse('one\ntwo')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'one\ntwo' }] },
    ]);
  });

  test('consecutive bullets are one list', () => {
    const blocks = parse('- a\n- b\n- c');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list' });
    expect(blocks[0]?.kind === 'list' && blocks[0].items).toHaveLength(3);
  });

  test('a bullet can carry markup', () => {
    const blocks = parse('- go **now**');
    expect(blocks[0]?.kind === 'list' && blocks[0].items[0]).toEqual({
      depth: 0,
      content: [
        { kind: 'text', text: 'go ' },
        { kind: 'bold', text: 'now' },
      ],
    });
  });

  // All three markers, because all three are what people type. `+` was missing
  // until the toolbar made the omission visible.
  test('dash, asterisk and plus all mean a bullet', () => {
    for (const marker of ['-', '*', '+']) {
      const blocks = parse(`${marker} a`);
      expect(blocks[0]?.kind).toBe('list');
    }
  });

  // Two spaces, which is also what Discord reads as a sub-bullet — so an
  // indented bullet means the same thing on the board and in the channel.
  test('two spaces make a sub-bullet, one does not', () => {
    const blocks = parse('- top\n  - under\n - still top');
    expect(blocks[0]?.kind === 'list' && blocks[0].items.map((i) => i.depth)).toEqual([0, 1, 0]);
  });

  // Clamped rather than ignored: somebody who indented four spaces meant a
  // sub-bullet, and dropping their intent is worse than flattening the depth.
  test('deeper indentation is clamped to one level', () => {
    const blocks = parse('- top\n      - deep');
    expect(blocks[0]?.kind === 'list' && blocks[0].items[1]?.depth).toBe(1);
  });

  // `#` alone is not a heading: a single hash starts an h1, and a body outranking
  // the page's own heading is an outline nobody can navigate.
  test('## and ### are headings, # is not', () => {
    expect(parse('## two')).toEqual([
      { kind: 'heading', level: 2, content: [{ kind: 'text', text: 'two' }] },
    ]);
    expect(parse('### three')).toEqual([
      { kind: 'heading', level: 3, content: [{ kind: 'text', text: 'three' }] },
    ]);
    expect(parse('# one')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: '# one' }] },
    ]);
  });

  test('a list interrupts a paragraph without swallowing it', () => {
    expect(parse('intro\n- a\n- b').map((b) => b.kind)).toEqual(['paragraph', 'list']);
  });

  // A textarea on Windows submits \r\n, and a stray \r would otherwise sit inside
  // the rendered text where nothing shows it.
  test('windows line endings do not leak into the text', () => {
    expect(JSON.stringify(parse('a\r\n\r\nb'))).not.toContain('\\r');
  });

  test('an empty body is no blocks at all', () => {
    expect(parse('')).toEqual([]);
    expect(parse('\n\n  \n')).toEqual([]);
  });
});

describe('images', () => {
  // A block, not an inline: an image halfway through a sentence is not what a
  // guide wants, and a block can be captioned.
  test('a line that is only an image becomes an image block', () => {
    expect(parse(`![a hero line-up](${OURS}/u/1.png)`)).toEqual([
      { kind: 'image', src: `${OURS}/u/1.png`, alt: 'a hero line-up' },
    ]);
  });

  // Empty alt is the CORRECT value for a decorative picture — a screen reader
  // skips it rather than reading a uuid aloud.
  test('no alt text is empty alt, not a missing field', () => {
    expect(parse(`![](${OURS}/u/1.png)`)).toEqual([
      { kind: 'image', src: `${OURS}/u/1.png`, alt: '' },
    ]);
  });

  // The privacy rule. An <img src> is fetched with no click, so an outside host
  // would collect a log line per reader — which is how many people opened the
  // guide, a question `post_reads` deliberately refuses to answer.
  test('an image from anywhere else stays text', () => {
    const blocks = parse('![x](https://example.invalid/tracker.png)');
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  // Not stripped — the author sees their markup and can work out why, instead of
  // wondering where the picture went.
  test('and keeps the characters that were typed', () => {
    const blocks = parse('![x](https://example.invalid/a.png)');
    expect(JSON.stringify(blocks)).toContain('example.invalid');
  });

  test('an image with words beside it is a paragraph, not an image', () => {
    expect(parse(`see this ![x](${OURS}/u/1.png)`)[0]?.kind).toBe('paragraph');
  });

  test('an image ends the paragraph above it', () => {
    const blocks = parse(`text
![x](${OURS}/u/1.png)
more`);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'image', 'paragraph']);
  });
});
