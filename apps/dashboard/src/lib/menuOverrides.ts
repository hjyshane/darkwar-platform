// The sidebar as an admin arranged it (owner, 2026-11-24): every entry and
// every screen under one renamed, reordered or hidden from edit mode.
//
// Stored where the Events strip's arrangement already is (ui_overrides, 0279),
// so it is display only: an address never moves, a gate never opens, and Tab
// visibility (0295) still decides per role on top of this. Hiding here hides
// for everybody; an admin in edit mode still sees the entry, dimmed, to bring
// it back. Settings › Change history (0347) records each change.
//
// What is NOT editable here, on purpose:
//   - moving an entry to another group (owner: not wanted);
//   - a screen's own tabs (Members' two rankings, the calculator's pages): the
//     page draws the same names in its own strip, and the two would disagree;
//   - the event screens under the alliance: the strip above them is where they
//     are arranged (EventsTabs, scope 'events-hub'), and the sidebar follows it;
//   - the footer (Settings, My account): the way back to all of this.
//
// Pure, so the rules are tested once and the sidebar only draws the result.

import { EVENTS_HUB_TABS } from './route';
import type { NavChild, NavGroup, NavItem } from './shellNav';
import { type Overrides, arrange, isHidden, labelOf, overrideKey } from './uiOverrides';

/** What the edit controls need to save a change to one entry. */
export interface MenuEditRef {
  scope: string;
  key: string;
  /** The name with no override, to clear rather than store the same text. */
  defaultLabel: string;
}

/** The scope holding the group captions ("Menu", "Admin menu"). */
export const GROUP_SCOPE = 'menu-groups';

/** ui_overrides.scope is `^[a-z][a-z0-9_-]{0,39}$`. */
function scopeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The scope for a group's entries: `menu-watch`, `menu-admin`. */
export function itemScope(groupId: string): string {
  return `menu-${scopeSlug(groupId)}`.slice(0, 40);
}

/** The scope for the screens under one entry: `menu-in-own-alliance`. */
export function childScope(itemKey: string): string {
  return `menu-in-${scopeSlug(itemKey) || 'root'}`.slice(0, 40);
}

/** ui_overrides.key is `^[A-Za-z0-9_.:-]{1,80}$`; entries are keyed by their
 * address (`#/calculator`), so the `#/` goes and any other `/` becomes `:`. */
export function menuKey(key: string): string {
  const slug = key
    .replace(/^#\/?/, '')
    .replace(/[^A-Za-z0-9_.:-]/g, ':')
    .slice(0, 80);
  return slug === '' ? 'root' : slug;
}

const EVENT_SCREENS: ReadonlySet<string> = new Set(EVENTS_HUB_TABS.map((tab) => tab.hash));

/** A screen filed under an entry, other than an event screen. */
function editableChild(child: NavChild): boolean {
  return child.screen === true && !EVENT_SCREENS.has(child.key);
}

/** Reorder only the editable entries, each moving among the places editable
 * entries had; the rest (a screen's own tabs, the event screens and their
 * captions) stay where the code put them. */
function arrangeInPlace<T>(
  list: readonly T[],
  editable: (item: T) => boolean,
  keyOf: (item: T) => string,
  o: Overrides,
  scope: string,
): T[] {
  const slots = list.flatMap((item, index) => (editable(item) ? [index] : []));
  const arranged = arrange(
    slots.map((index) => list[index] as T),
    keyOf,
    o,
    scope,
  );
  const out = [...list];
  slots.forEach((slot, n) => {
    out[slot] = arranged[n] as T;
  });
  return out;
}

function applyToChildren(item: NavItem, o: Overrides, showHidden: boolean): NavItem {
  const children = item.children;
  if (children === undefined || !children.some(editableChild)) return item;
  const scope = childScope(item.key);
  const arranged = arrangeInPlace(children, editableChild, (child) => menuKey(child.key), o, scope)
    .map((child): NavChild => {
      if (!editableChild(child)) return child;
      const key = menuKey(child.key);
      return {
        ...child,
        label: labelOf(o, scope, key, child.label),
        edit: { scope, key, defaultLabel: child.label },
        ...(isHidden(o, scope, key) ? { hidden: true } : {}),
      };
    })
    .filter((child) => showHidden || child.hidden !== true);
  // An entry that opened its first screen opens the first one still shown.
  const opened = children[0]?.href === item.href ? arranged.find((c) => c.hidden !== true) : null;
  return {
    ...item,
    children: arranged,
    ...(opened ? { href: opened.href } : {}),
  };
}

/** The groups with the admin's names, order and hidden entries applied. With
 * `showHidden` (an admin in edit mode) hidden ones stay, marked `hidden`. */
export function applyMenuOverrides(
  groups: readonly NavGroup[],
  o: Overrides,
  showHidden = false,
): NavGroup[] {
  return groups
    .map((group): NavGroup => {
      const scope = itemScope(group.id);
      const items = arrange(group.items, (item) => menuKey(item.key), o, scope)
        .map((item): NavItem => {
          const key = menuKey(item.key);
          const withChildren = applyToChildren(item, o, showHidden);
          return {
            ...withChildren,
            label: labelOf(o, scope, key, item.label),
            edit: { scope, key, defaultLabel: item.label },
            ...(isHidden(o, scope, key) ? { hidden: true } : {}),
          };
        })
        // An entry whose screens are all hidden has nothing to open.
        .filter(
          (item) =>
            showHidden ||
            (item.hidden !== true && (item.children === undefined || item.children.length > 0)),
        );
      return {
        ...group,
        label: labelOf(o, GROUP_SCOPE, group.id, group.label),
        edit: { scope: GROUP_SCOPE, key: group.id, defaultLabel: group.label },
        items,
      };
    })
    .filter((group) => showHidden || group.items.length > 0);
}

/** Every entry the admin's arrangement could touch, for "Reset the menu":
 * only those with something stored, so the reset is as many calls as there
 * are changes. */
export function storedMenuRefs(groups: readonly NavGroup[], o: Overrides): MenuEditRef[] {
  const refs: MenuEditRef[] = [];
  for (const group of groups) {
    if (group.edit !== undefined) refs.push(group.edit);
    for (const item of group.items) {
      if (item.edit !== undefined) refs.push(item.edit);
      for (const child of item.children ?? []) {
        if (child.edit !== undefined) refs.push(child.edit);
      }
    }
  }
  return refs.filter((ref) =>
    (['label', 'order', 'hidden'] as const).some((kind) =>
      o.has(overrideKey(ref.scope, ref.key, kind)),
    ),
  );
}
