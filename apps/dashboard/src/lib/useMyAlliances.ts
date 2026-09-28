import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getActiveAlliance, setActiveAlliance } from './activeAlliance';
import { supabase } from './supabase';
import { type AppRole, useSession } from './useSession';

export interface MyAlliance {
  alliance_id: string;
  name: string;
  code: string;
  server_id: number;
  role: AppRole;
}

/** The own alliances this account may view, primary first (0193
 * `my_alliances`). Admins get every one. Empty when signed out. */
export function useMyAlliances() {
  const { data: session } = useSession();
  const signedIn = session?.userId != null;
  return useQuery({
    queryKey: ['my-alliances', session?.userId ?? null],
    enabled: session !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MyAlliance[]> => {
      if (!signedIn) {
        return [];
      }
      const { data, error } = await supabase.rpc('my_alliances');
      if (error) {
        throw new Error(`my alliances query failed: ${error.message}`);
      }
      return (data ?? []).map((row) => ({ ...row, role: row.role as AppRole }));
    },
  });
}

/** The alliance being viewed, the others on offer, and the way to switch.
 *
 * Switching changes the header on every later request, so everything cached
 * was fetched as the other alliance: all of it is invalidated at once rather
 * than trusting each query key to have mentioned the alliance.
 */
export function useActiveAlliance() {
  const queryClient = useQueryClient();
  const { data: alliances } = useMyAlliances();
  const stored = getActiveAlliance();
  const active = alliances?.find((a) => a.alliance_id === stored) ?? alliances?.[0] ?? null;

  // A stored choice this account can no longer view (left, removed, or a
  // different person on this browser) falls back to the first on offer.
  useEffect(() => {
    if (alliances === undefined) {
      return;
    }
    const next = active?.alliance_id ?? null;
    if (next !== stored) {
      setActiveAlliance(next);
      void queryClient.invalidateQueries();
    }
  }, [alliances, active, stored, queryClient]);

  const switchTo = (allianceId: string) => {
    if (allianceId === getActiveAlliance()) {
      return;
    }
    setActiveAlliance(allianceId);
    void queryClient.invalidateQueries();
  };

  return { alliances: alliances ?? [], active, switchTo };
}
