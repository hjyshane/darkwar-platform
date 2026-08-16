import { useState } from 'react';
import {
  type Block,
  type ImageSize,
  type Inline,
  type ListItem,
  parse,
  parseInline,
} from '../lib/richText';
import { useSignedImage } from '../lib/signedImage';

/** Render the markup subset from `lib/richText`.
 *
 * Every node becomes a React element. There is no `dangerouslySetInnerHTML` in
 * this file and there must never be one: the guarantee that a member cannot put
 * script into everyone else's page comes from never handing a string to the DOM
 * as markup, not from a sanitizer being thorough enough.
 *
 * So `<script>alert(1)</script>` in a notice renders as that text, visibly. It is
 * not stripped — it is not markup in the first place.
 */
function InlineRun({ node }: { node: Inline }) {
  switch (node.kind) {
    case 'bold':
      return <strong>{node.text}</strong>;
    case 'italic':
      return <em>{node.text}</em>;
    case 'code':
      return <code>{node.text}</code>;
    case 'colour':
      // A class, never a style attribute: the palette is an allowlist of names
      // in `richText.ts`, and letting a body choose arbitrary CSS is how a
      // notice ends up with white text on white.
      return <span className={`ink ink-${node.colour}`}>{node.text}</span>;
    case 'link':
      // `noreferrer` as well as `noopener`: the alliance's dashboard should not
      // announce itself to whatever a member linked to. External by default
      // because the subset has no way to write an internal link — every href
      // here came from somebody typing a URL.
      return (
        <a href={node.href} rel="noreferrer noopener" target="_blank">
          {node.text}
        </a>
      );
    default:
      // Text keeps its newlines. `.rich-text` sets pre-line, because somebody
      // writing a notice used those newlines to mean newlines.
      return <>{node.text}</>;
  }
}

function Content({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((node, index) => (
        <InlineRun
          // biome-ignore lint/suspicious/noArrayIndexKey: derived from one immutable string and replaced whole, so nothing reorders
          key={index}
          node={node}
        />
      ))}
    </>
  );
}

/** Bullets, with sub-bullets inside their parent's `<li>`.
 *
 * Nesting a `<ul>` as a SIBLING of the `<li>` it belongs under is the common
 * mistake and it is invalid HTML — a `<ul>` may only contain `<li>`. Browsers
 * render it anyway, which is why it survives, and screen readers then announce a
 * list of one item followed by an unrelated list.
 *
 * A sub-bullet with no parent above it (somebody indented the first line) is
 * promoted rather than dropped: their intent was a bullet, and the indentation
 * was the part that could not be honoured.
 */
function NestedList({ items }: { items: ListItem[] }) {
  const groups: { item: ListItem; children: ListItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.depth === 1 && last !== undefined) {
      last.children.push(item);
    } else {
      groups.push({ item, children: [] });
    }
  }
  return (
    <ul>
      {groups.map((group, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: derived from one immutable string and replaced whole, so nothing reorders
        <li key={index}>
          <Content content={group.item.content} />
          {group.children.length > 0 && (
            <ul>
              {group.children.map((child, childIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: same immutable string
                <li key={childIndex}>
                  <Content content={child.content} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One picture, signed for this reader.
 *
 * The bucket is private (0083), so the URL in the body is a NAME for the object
 * rather than an address that works. Storage mints a short-lived signed URL for a
 * session RLS already allows, and that is what goes in the `src`.
 *
 * `loading="lazy"` because a guide can carry several and only the first is above
 * the fold. No width or height: the file's own dimensions are unknown here and the
 * stylesheet caps it — a guessed pair would either squash the picture or reserve
 * the wrong space.
 *
 * The alt text is whatever the author typed between the brackets, and empty when
 * they typed nothing. Empty alt is the CORRECT value for a decorative image: a
 * screen reader skips it rather than reading a uuid aloud, and an invented
 * description would be worse than none.
 */
/** The figure's classes.
 *
 * `small` is dropped once the picture is expanded rather than left on beside
 * `expanded`. Both rules cap the same property at the same specificity, so
 * which one wins would come down to their order in the stylesheet — and a
 * thumbnail that refuses to open because somebody reordered a file is the kind
 * of bug that takes an afternoon.
 */
function figureClass(size: ImageSize, expanded: boolean): string {
  if (expanded) {
    return 'rich-image rich-image-expanded';
  }
  return size === 'small' ? 'rich-image rich-image-small' : 'rich-image';
}

function PostImage({ src, alt, size }: { src: string; alt: string; size: ImageSize }) {
  const { data: signed, isPending, error } = useSignedImage(src);
  // Capped by default and expandable in place — a tall phone screenshot should
  // not bury the sentence after it. `wide` is the author having already decided
  // this one is worth the width (a map, a table), so it opens expanded; `small`
  // is the opposite decision, an icon that would be silly at reading size.
  //
  // EVERY SIZE STAYS OPENABLE, including small. The author's choice sets where
  // the picture starts, not what the reader is allowed to see — somebody who
  // cannot make out a thumbnail should be one press away from the full thing.
  const [expanded, setExpanded] = useState(size === 'wide');

  if (error) {
    // Said rather than left as a broken frame. A reader who cannot load the
    // picture should know it is a permission or a network problem and not that the
    // author forgot to attach anything.
    return <p className="empty">A picture here could not be loaded.</p>;
  }
  if (isPending || signed == null) {
    // A placeholder of the right shape, so the text below does not jump when the
    // picture arrives.
    return (
      <figure className="rich-image rich-image-pending">
        <p className="empty">Loading the picture…</p>
      </figure>
    );
  }
  return (
    <figure className={figureClass(size, expanded)}>
      {/* A button, not a link with an onClick: this changes what is on the page
          rather than going anywhere, and a screen reader should be told which.
          The label says what pressing it does, and it changes with the state —
          a control whose name is "Expand" while the picture is expanded is
          worse than no label at all. */}
      <button
        aria-expanded={expanded}
        className="rich-image-button"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Shrink back' : 'Fill the page width'}
        type="button"
      >
        <img alt={alt} loading="lazy" src={signed} />
      </button>
      {alt !== '' && <figcaption>{alt}</figcaption>}
    </figure>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h3>
          <Content content={block.content} />
        </h3>
      ) : (
        <h4>
          <Content content={block.content} />
        </h4>
      );
    case 'list':
      return <NestedList items={block.items} />;
    case 'image':
      return <PostImage alt={block.alt} size={block.size} src={block.src} />;
    default:
      return (
        <p>
          <Content content={block.content} />
        </p>
      );
  }
}

/** A title, with the same inline markup a paragraph gets.
 *
 * Titles are one line, so only the INLINE half of the subset applies — there
 * is no heading inside a heading and no bullet in a title. `parseInline`
 * rather than `parse` is what says so.
 *
 * Used by the post page and by both board lists, so a title that is bold in
 * one place is bold in all of them. A title is still plain text in the
 * database; this is the only thing that reads the markers.
 */
export function RichTitle({ title }: { title: string }) {
  return <Content content={parseInline(title)} />;
}

export function RichText({ body }: { body: string }) {
  const blocks = parse(body);
  return (
    <div className="rich-text">
      {blocks.map((block, index) => (
        <BlockNode
          block={block}
          // biome-ignore lint/suspicious/noArrayIndexKey: derived from one immutable string and replaced whole, so nothing reorders
          key={index}
        />
      ))}
    </div>
  );
}
