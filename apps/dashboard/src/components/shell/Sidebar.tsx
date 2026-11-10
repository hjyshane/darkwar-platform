import { useEffect, useRef, useState } from 'react';
import type { NavGroup, NavItem } from '../../lib/shellNav';
import { Icon } from './icons';

function Entry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  // A screen with subpages is a folder, not a destination: clicking it unfolds
  // or folds its list, and only a subpage in the list navigates. It starts open
  // while it is the screen shown. The collapsed rail has no room for a second
  // level, so there the entry is a plain link to the screen's main page.
  const [manual, setManual] = useState<boolean | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the trigger
  useEffect(() => setManual(null), [item.current]);
  const folder = item.children !== undefined && !collapsed;
  const open = folder && (manual ?? item.current);
  const inner = (
    <>
      <Icon name={item.icon} />
      <span className="shell-link-label">{item.label}</span>
      {item.children !== undefined && (
        <span aria-hidden="true" className="shell-caret" data-open={open}>
          <Icon name="chevron" size={12} />
        </span>
      )}
    </>
  );
  return (
    <div className="shell-entry">
      {folder ? (
        <button
          aria-current={item.current ? 'page' : undefined}
          aria-expanded={open}
          className="shell-link"
          onClick={() => setManual(!open)}
          type="button"
        >
          {inner}
        </button>
      ) : (
        <a
          aria-current={item.current ? 'page' : undefined}
          className="shell-link"
          href={item.href}
          // The label is the accessible name either way; the title only gives the
          // collapsed rail something to say on hover.
          title={collapsed ? item.label : undefined}
        >
          {inner}
        </a>
      )}
      {open && item.children !== undefined && (
        <ul className="shell-sub">
          {item.children.map((child) => (
            <li key={child.key}>
              <a
                aria-current={child.current ? 'page' : undefined}
                className="shell-sublink"
                href={child.href}
              >
                {child.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The screens, all at once, grouped by what you came to do. */
export function Sidebar({
  groups,
  footer,
  collapsed,
  onCollapse,
}: {
  groups: readonly NavGroup[];
  footer: readonly NavItem[];
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const here = [...groups.flatMap((group) => group.items), ...footer]
    .map(
      (item) => `${item.key}:${item.current}:${item.children?.find((child) => child.current)?.key}`,
    )
    .join('|');

  // On a phone the list scrolls inside the drawer, and the open screen's tabs
  // can sit below the fold. Bring the one that is open into view when the
  // address changes. `nearest` leaves the list alone when it is already seen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `here` is the trigger
  useEffect(() => {
    const open = nav.current?.querySelector('.shell-sublink[aria-current="page"]');
    const target = open ?? nav.current?.querySelector('.shell-link[aria-current="page"]');
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [here]);

  return (
    <aside className="shell-sidebar">
      <a className="shell-brand" href="#/" title={collapsed ? 'Dark War' : undefined}>
        <span aria-hidden="true" className="shell-mark">
          DW
        </span>
        <span className="shell-brand-name">Dark War</span>
      </a>
      <nav aria-label="Screens" className="shell-nav" ref={nav}>
        {groups.map((group) => (
          <section aria-label={group.label} className="shell-group" key={group.id}>
            <h2 className="shell-group-label">{group.label}</h2>
            {group.items.map((item) => (
              <Entry collapsed={collapsed} item={item} key={item.key} />
            ))}
          </section>
        ))}
      </nav>
      <div className="shell-foot">
        {footer.map((item) => (
          <Entry collapsed={collapsed} item={item} key={item.key} />
        ))}
        <button
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          className="shell-collapse"
          onClick={onCollapse}
          type="button"
        >
          <Icon name="collapse" />
        </button>
      </div>
    </aside>
  );
}
