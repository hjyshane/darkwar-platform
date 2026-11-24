import { isAllowed, usePermissions } from './permissions';
import { useSession } from './useSession';

/** Whether this reader may be offered a gated screen (0063, 0064).
 *
 * Undefined while the grid is still loading, which callers must treat as
 * "not yet" rather than "no": rendering the tab and then taking it away is
 * worse than a tab that appears a beat late.
 *
 * This hides a tab. It does not withhold anything — RLS does that, and for
 * the arena it does it on all four tables (0064). A reader who types the
 * address gets the screen's own empty state, not the data.
 */
export function useMayView(capability: string): boolean | undefined {
  const { data: session } = useSession();
  const { data: permissions, isPending } = usePermissions();
  if (isPending) {
    return undefined;
  }
  return isAllowed(permissions?.grants, session?.role, capability);
}
