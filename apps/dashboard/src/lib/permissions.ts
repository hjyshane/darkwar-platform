import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** What each role may do, as the database sees it.
 *
 * The dashboard reads this to grey out a control it knows will be refused.
 * It is NOT the boundary — RLS is, and every form here still reports what
 * the database said rather than deciding in advance. The grid being
 * readable by anyone signed in is deliberate: hiding the rules would not
 * change them, and a control that fails silently is worse than one that
 * says why.
 */
export interface Capability {
  capability: string;
  label: string;
  description: string;
  sort_order: number;
}

export interface RolePermission {
  role: string;
  capability: string;
  allowed: boolean;
}

/** The four roles a person can hold, weakest first — the order the grid's
 * columns run in. The two service roles in the enum are not here: nobody
 * signs in as one and the grid would be offering to configure a key. */
export const APP_ROLES = ['viewer', 'member', 'officer', 'admin'] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** The player's standing inside the alliance. Shown, never enforced: a
 * promotion in game must not hand out write access to this app, so no
 * policy reads it and 26_permissions_test fails if one starts. */
export const GAME_RANKS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

export async function fetchPermissions(): Promise<{
  capabilities: Capability[];
  grants: RolePermission[];
}> {
  const [caps, grants] = await Promise.all([
    supabase
      .from('capabilities')
      .select('capability, label, description, sort_order')
      .order('sort_order'),
    supabase.from('role_permissions').select('role, capability, allowed'),
  ]);
  if (caps.error) {
    throw new Error(`capability query failed: ${caps.error.message}`);
  }
  if (grants.error) {
    throw new Error(`permission query failed: ${grants.error.message}`);
  }
  return {
    capabilities: (caps.data ?? []) as Capability[],
    grants: (grants.data ?? []) as RolePermission[],
  };
}

export function usePermissions() {
  return useQuery({ queryKey: ['permissions'], queryFn: fetchPermissions });
}

/** Whether a role holds a capability. Absent means no — a missing row is a
 * permission nobody granted, which is the same thing as a denied one. */
export function isAllowed(
  grants: readonly RolePermission[] | undefined,
  role: string | null | undefined,
  capability: string,
): boolean {
  if (role == null) {
    return false;
  }
  return (
    grants?.some(
      (grant) => grant.role === role && grant.capability === capability && grant.allowed,
    ) ?? false
  );
}
