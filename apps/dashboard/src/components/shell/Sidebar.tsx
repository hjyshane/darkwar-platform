import type { NavGroup, NavItem } from '../../lib/shellNav';
import { Icon } from './icons';

function Entry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <a
      aria-current={item.current ? 'page' : undefined}
      className="shell-link"
      href={item.href}
      // The label is the accessible name either way; the title only gives the
      // collapsed rail something to say on hover.
      title={collapsed ? item.label : undefined}
    >
      <Icon name={item.icon} />
      <span className="shell-link-label">{item.label}</span>
    </a>
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
  return (
    <aside className="shell-sidebar">
      <a className="shell-brand" href="#/" title={collapsed ? 'Dark War' : undefined}>
        <span aria-hidden="true" className="shell-mark">
          DW
        </span>
        <span className="shell-brand-name">Dark War</span>
      </a>
      <nav aria-label="Screens" className="shell-nav">
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
