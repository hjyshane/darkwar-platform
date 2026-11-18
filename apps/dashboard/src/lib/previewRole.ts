// "View as": an admin looks at the site the way a member, an officer or a
// community account would.
//
// WHAT IT CHANGES. Only the role the DASHBOARD reads (useSession), so the
// sidebar, Settings → Tab visibility, the officer-only controls and the
// community limits all behave as they would for that role.
//
// WHAT IT DOES NOT CHANGE. The database still answers as the admin: RLS reads
// the real JWT, so a preview can show rows the previewed role could not read
// (another member's details, a deleted plan an officer could restore). The
// banner says so. It is a preview of the screens, not of the permissions.
//
// Per tab (sessionStorage), and only ever applied to an account whose real
// role is admin — see useSession.

import { useSyncExternalStore } from 'react';
import type { AppRole } from './useSession';

export const PREVIEW_ROLES = ['member', 'officer', 'community'] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

const STORAGE_KEY = 'dw-preview-role';

function isPreviewRole(value: unknown): value is PreviewRole {
  return (PREVIEW_ROLES as readonly unknown[]).includes(value);
}

function readStored(): PreviewRole | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return isPreviewRole(value) ? value : null;
  } catch {
    return null;
  }
}

let current: PreviewRole | null = typeof window === 'undefined' ? null : readStored();
const listeners = new Set<() => void>();

export function getPreviewRole(): PreviewRole | null {
  return current;
}

export function setPreviewRole(role: PreviewRole | null): void {
  current = role;
  try {
    if (role === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, role);
  } catch {
    // A blocked storage only means the preview does not survive a reload.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewRole(): PreviewRole | null {
  return useSyncExternalStore(subscribe, getPreviewRole, () => null);
}

/** The role the dashboard should act on: the preview, but only for an admin. */
export function effectiveRole(real: AppRole, preview: PreviewRole | null): AppRole {
  return real === 'admin' && preview !== null ? preview : real;
}

export function previewLabel(role: PreviewRole): string {
  return role === 'member' ? 'Member view' : role === 'officer' ? 'Officer view' : 'Community view';
}
