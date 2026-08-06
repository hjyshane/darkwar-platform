import { type Block, type Inline, parse } from '../lib/richText';

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
      return (
        <ul>
          {block.items.map((item, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: derived from one immutable string and replaced whole, so nothing reorders
              key={index}
            >
              <Content content={item} />
            </li>
          ))}
        </ul>
      );
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
