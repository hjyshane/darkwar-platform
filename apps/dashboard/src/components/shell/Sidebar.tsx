import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import type { MenuEditRef } from '../../lib/menuOverrides';
import type { NavGroup, NavItem } from '../../lib/shellNav';
import { MenuEditControls, ResetMenuButton, editKeys } from './MenuEdit';
import { Icon } from './icons';

function Entry({
  item,
  collapsed,
  editing = false,
  siblings,
}: {
  item: NavItem;
  collapsed: boolean;
  /** An admin in edit mode: the controls beside each entry it can change. */
  editing?: boolean;
  siblings?: readonly string[];
}) {
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
  const childKeys = editKeys(item.children ?? []);
  return (
    <div className={`shell-entry${item.hidden === true ? ' menu-hidden' : ''}`}>
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
      {editing && !collapsed && item.edit !== undefined && (
        <MenuEditControls
          edit={item.edit}
          hidden={item.hidden === true}
          label={item.label}
          siblings={siblings}
        />
      )}
      {open && item.children !== undefined && (
        <ul className="shell-sub">
          {item.children.map((child) => (
            <li className={child.hidden === true ? 'menu-hidden' : undefined} key={child.key}>
              {child.heading !== undefined && (
                <span className="shell-subhead">{child.heading}</span>
              )}
              <a
                aria-current={child.current ? 'page' : undefined}
                className="shell-sublink"
                href={child.href}
              >
                {child.label}
              </a>
              {editing && child.edit !== undefined && (
                <MenuEditControls
                  edit={child.edit}
                  hidden={child.hidden === true}
                  label={child.label}
                  siblings={childKeys}
                />
              )}
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
  editing = false,
  stored = [],
}: {
  groups: readonly NavGroup[];
  footer: readonly NavItem[];
  collapsed: boolean;
  onCollapse: () => void;
  /** An admin in edit mode (menuOverrides.ts): rename, move and hide entries. */
  editing?: boolean;
  /** The entries an admin has changed, for "Reset the menu". */
  stored?: readonly MenuEditRef[];
}) {
  const editable = editing && !collapsed;
  const nav = useRef<HTMLElement>(null);
  const t = useT();
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
      <nav aria-label={t('Screens')} className="shell-nav" ref={nav}>
        {groups.map((group) => (
          <section aria-label={group.label} className="shell-group" key={group.id}>
            <h2 className="shell-group-label">
              {group.label}
              {editable && group.edit !== undefined && (
                <MenuEditControls
                  canHide={false}
                  edit={group.edit}
                  hidden={false}
                  label={group.label}
                />
              )}
            </h2>
            {group.items.map((item) => (
              <Entry
                collapsed={collapsed}
                editing={editable}
                item={item}
                key={item.key}
                siblings={editKeys(group.items)}
              />
            ))}
          </section>
        ))}
        {editable && (
          <p className="menu-edit-note">
            Edit mode: names, order and hidden entries are saved for everyone. Event screens are
            arranged from the strip above them. <ResetMenuButton stored={stored} />
          </p>
        )}
      </nav>
      <div className="shell-foot">
        {footer.map((item) => (
          <Entry collapsed={collapsed} item={item} key={item.key} />
        ))}
        <button
          aria-label={collapsed ? t('Expand the sidebar') : t('Collapse the sidebar')}
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
