import { useEffect, useRef } from 'react';
import type { NavGroup, NavItem } from '../../lib/shellNav';
import { Icon } from './icons';

function Entry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  // A screen with tabs unfolds them while it is the one open. Clicking it goes
  // to its main page, which is what makes it current. The collapsed rail has no
  // room for a second level, so it shows none.
  const open = item.children !== undefined && item.current && !collapsed;
  return (
    <div className="shell-entry">
      <a
        aria-current={item.current ? 'page' : undefined}
        aria-expanded={item.children === undefined ? undefined : open}
        className="shell-link"
        href={item.href}
        // The label is the accessible name either way; the title only gives the
        // collapsed rail something to say on hover.
        title={collapsed ? item.label : undefined}
      >
        <Icon name={item.icon} />
        <span className="shell-link-label">{item.label}</span>
        {item.children !== undefined && (
          <span aria-hidden="true" className="shell-caret" data-open={open}>
            <Icon name="chevron" size={12} />
          </span>
        )}
      </a>
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
