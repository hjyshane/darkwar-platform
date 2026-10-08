import { type ReactNode, useEffect, useState } from 'react';
import type { Route } from '../../lib/route';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { StatusLine } from './StatusLine';
import { Icon } from './icons';
import { useShellNav } from './useShellNav';

const KEY = 'dw-sidebar';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? 'collapsed' : 'open');
  } catch {
    // A private window or blocked storage: the choice just does not stick.
  }
}

/** The frame around every member screen: a sidebar on the left, a top bar over
 * the content, and the content itself.
 *
 * Pages keep rendering their own `<main>`; this only supplies what is around
 * it, which is why the screens did not have to change. The controls that used
 * to sit in the title row (sync badge, refresh, account, sign out, theme) come
 * in as `controls` and keep their own behaviour.
 *
 * Below 900px the sidebar is a drawer behind a menu button, because a 220px
 * column beside a phone-width table is the layout the old header's scrolling
 * tab row existed to avoid. */
export function AppShell({
  route,
  allianceId,
  controls,
  children,
}: {
  route: Route;
  allianceId: string | null;
  controls: ReactNode;
  children: ReactNode;
}) {
  const { groups, footer, crumbs } = useShellNav(route, allianceId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  // A hash change is navigation: the drawer has done its job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is the trigger
  useEffect(() => setDrawer(false), [route, allianceId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (event.key === 'Escape') {
        setDrawer(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = [...groups.flatMap((group) => group.items), ...footer];
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    storeCollapsed(next);
  };

  return (
    <div
      className={`shell${collapsed ? ' shell-collapsed' : ''}${drawer ? ' shell-drawer-open' : ''}`}
    >
      <Sidebar collapsed={collapsed} footer={footer} groups={groups} onCollapse={toggleCollapsed} />
      <button
        aria-label="Close the menu"
        className="shell-scrim"
        onClick={() => setDrawer(false)}
        tabIndex={-1}
        type="button"
      />
      <div className="shell-main">
        <header className="shell-top">
          <button
            aria-expanded={drawer}
            aria-label="Open the menu"
            className="shell-menu"
            onClick={() => setDrawer((open) => !open)}
            type="button"
          >
            <Icon name="menu" size={18} />
          </button>
          <nav aria-label="You are here" className="shell-crumbs">
            {crumbs.map((crumb, index) => (
              <span
                aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                className="shell-crumb"
                key={crumb}
              >
                {crumb}
              </span>
            ))}
          </nav>
          <button className="shell-find" onClick={() => setPalette(true)} type="button">
            <Icon name="search" />
            <span className="shell-find-text">Go to a screen</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="shell-controls">{controls}</div>
        </header>
        <StatusLine />
        <div className="shell-content">{children}</div>
      </div>
      <CommandPalette items={all} onClose={() => setPalette(false)} open={palette} />
    </div>
  );
}
