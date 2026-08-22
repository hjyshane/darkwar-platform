import { type AppRole, type Capability, type RolePermission, isAllowed } from './permissions';
import type { AdminGroup } from './route';

/** What each settings section needs, mirroring the policy that guards it.
 *
 * The page used to ask one question — `role === 'admin'` — and tell everyone
 * else "saving needs an admin". That has been wrong since 0045 made
 * permissions data: an officer granted `members.manage` can edit the member
 * table, the permission grid and the rank column, and the banner told them
 * they could not. It was also wrong in the other direction, since it implied
 * an admin-shaped answer covered all five groups.
 *
 * Two shapes of requirement, because the schema really does have two:
 *
 *   capability   the 0045 registry, editable in the Permissions grid.
 *   role         `join_codes` and `notification_channels` still spell out
 *                `current_app_role() = 'admin'` in their own policies. They
 *                are named honestly here rather than dressed up as a
 *                capability that does not exist — a capability with no
 *                policy behind it is a switch that does nothing.
 *
 * Nothing here reads `game_rank`, and nothing should: 0045 keeps R1-R5 as a
 * label precisely so a promotion in the game cannot hand out write access to
 * this app.
 *
 * This is still not the boundary. RLS refuses the write whatever this file
 * says, and every section reports what the database answered. What this buys
 * is a true sentence instead of a false one.
 */
export type AdminRequirement =
  | { kind: 'capability'; capability: string }
  | { kind: 'role'; role: AppRole };

export interface AdminSection {
  group: AdminGroup;
  /** Matches the `aria-labelledby` id already on the section. */
  id: string;
  heading: string;
  /** Null for a section that only reads — refusing to show it would be
   *  hiding information the viewer is allowed to have. */
  requires: AdminRequirement | null;
}

/** The slug an address uses for a section, derived from the heading id it
 * already carries (`members-heading` -> `members`).
 *
 * Derived rather than stored as a second field, so a section cannot end up
 * with an id and a slug that disagree — the id is already the thing the
 * `aria-labelledby` on the panel uses. */
export function sectionSlug(section: AdminSection): string {
  return section.id.replace(/-heading$/, '');
}

const capability = (name: string): AdminRequirement => ({ kind: 'capability', capability: name });
const adminOnly: AdminRequirement = { kind: 'role', role: 'admin' };

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  // app_users, role_permissions, player_ranks, player_claims -> members.manage
  {
    group: 'access',
    id: 'members-heading',
    heading: 'Members',
    requires: capability('members.manage'),
  },
  // join_codes still keys on the role directly (0021), not a capability.
  { group: 'access', id: 'join-codes-heading', heading: 'Invitations', requires: adminOnly },
  { group: 'access', id: 'departed-heading', heading: 'Left the alliance', requires: null },
  // activity_events, activity_scores -> members.manage. Read-only, but the
  // requirement is named rather than left null: `null` here means "showing
  // this to anyone who can reach the page is fine", and a table of who has
  // been paying attention is not that. The view enforces it either way.
  {
    group: 'access',
    id: 'activity-heading',
    heading: 'Activity this week',
    requires: capability('members.manage'),
  },
  {
    group: 'access',
    id: 'permissions-heading',
    heading: 'Permissions',
    requires: capability('members.manage'),
  },

  // app_settings -> settings.write
  {
    group: 'alliance',
    id: 'own-alliance-heading',
    heading: 'Our alliance',
    requires: capability('settings.write'),
  },
  {
    group: 'alliance',
    id: 'rank-tiers-heading',
    heading: 'How ranks are decided',
    requires: capability('settings.write'),
  },
  // build_rank_period() is officer-gated (0112) and refuses the service key
  // outright; reading the report needs nothing beyond being signed in. A
  // member who reaches the Rebuild button gets the function's own 42501, not
  // a wrong rebuild.
  { group: 'alliance', id: 'rank-report-heading', heading: 'Rank changes', requires: null },

  {
    group: 'display',
    id: 'metrics-heading',
    heading: 'Overview figures',
    requires: capability('settings.write'),
  },
  {
    group: 'display',
    id: 'formulas-heading',
    heading: 'Member columns',
    requires: capability('settings.write'),
  },
  {
    group: 'display',
    id: 'table-layout-heading',
    heading: 'Table columns',
    requires: capability('settings.write'),
  },
  {
    group: 'display',
    id: 'season-building-alert-heading',
    heading: 'Season building alert',
    requires: capability('settings.write'),
  },
  { group: 'display', id: 'notices-heading', heading: 'Notices', requires: null },

  // heroes, pets -> catalogue.write
  {
    group: 'catalogue',
    id: 'heroes-heading',
    heading: 'Heroes',
    requires: capability('catalogue.write'),
  },
  {
    group: 'catalogue',
    id: 'pets-heading',
    heading: 'Pets',
    requires: capability('catalogue.write'),
  },

  // The collector writes these with the service key; there is no cloud-side
  // control, so they answer questions rather than offering buttons.
  { group: 'operations', id: 'collectors-heading', heading: 'Collector health', requires: null },
  {
    group: 'operations',
    id: 'discovery-heading',
    heading: 'Unrecognized commands',
    requires: null,
  },
  // notification_channels: admin_all, on the role.
  {
    group: 'operations',
    id: 'notifications-heading',
    heading: 'Discord notifications',
    requires: adminOnly,
  },
];

export function sectionsIn(group: AdminGroup): readonly AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => section.group === group);
}

/** Whether the viewer's role satisfies a requirement.
 *
 * A missing grant row is a denial: a permission nobody granted and one
 * somebody revoked are the same answer.
 */
export function holds(
  requirement: AdminRequirement | null,
  role: AppRole | null | undefined,
  grants: readonly RolePermission[] | undefined,
): boolean {
  if (requirement === null) {
    return true;
  }
  if (requirement.kind === 'role') {
    return role === requirement.role;
  }
  return isAllowed(grants, role, requirement.capability);
}

/** What to call a requirement on screen.
 *
 * Capability labels come from the database rather than from a second copy
 * here, so renaming one in the registry renames it on this page too. The
 * capability string is the fallback: an unlabelled capability is a bug in the
 * registry, and showing its name is more useful than showing nothing.
 */
export function describe(
  requirement: AdminRequirement,
  capabilities: readonly Capability[] | undefined,
): string {
  if (requirement.kind === 'role') {
    return `the ${requirement.role} role`;
  }
  const found = capabilities?.find((entry) => entry.capability === requirement.capability);
  return `"${found?.label ?? requirement.capability}"`;
}

/** The distinct things this group needs that the viewer does not have.
 *
 * Distinct, because Access asks for `members.manage` twice and naming it
 * twice in one sentence reads like a fault in the page.
 */
export function missingIn(
  group: AdminGroup,
  role: AppRole | null | undefined,
  grants: readonly RolePermission[] | undefined,
): readonly AdminRequirement[] {
  const missing: AdminRequirement[] = [];
  for (const section of sectionsIn(group)) {
    const requirement = section.requires;
    if (requirement === null || holds(requirement, role, grants)) {
      continue;
    }
    const already = missing.some(
      (entry) =>
        entry.kind === requirement.kind &&
        (entry.kind === 'role'
          ? entry.role === (requirement as { role: AppRole }).role
          : entry.capability === (requirement as { capability: string }).capability),
    );
    if (!already) {
      missing.push(requirement);
    }
  }
  return missing;
}

/** Whether the group holds anything at all the viewer may change.
 *
 * Used to mark the tab, not to remove it. A group that is entirely read-only
 * for you is still worth reading — Operations is read-only for everybody
 * except its one Discord section — and hiding it would answer "where did
 * Catalogue go" with silence.
 */
export function canWriteAnything(
  group: AdminGroup,
  role: AppRole | null | undefined,
  grants: readonly RolePermission[] | undefined,
): boolean {
  return sectionsIn(group).some(
    (section) => section.requires !== null && holds(section.requires, role, grants),
  );
}
