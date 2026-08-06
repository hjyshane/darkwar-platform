import { type Block, type Inline, type ListItem, parse } from '../lib/richText';

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
    default:
      return (
        <p>
          <Content content={block.content} />
        </p>
      );
  }
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
