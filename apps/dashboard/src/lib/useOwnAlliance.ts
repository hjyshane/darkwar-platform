import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useActiveAlliance } from './useMyAlliances';

/** Which alliance is ours, for anybody who may see it.
 *
 * The admin screens already resolved this, but through `app_settings` and behind
 * `settings.write` — no use to a member who just wants the tab. `alliances.is_own`
 * is readable by any member (0065's `member_read`), so the tab needs nothing
 * privileged.
 *
 * Returns null rather than throwing when nothing is pinned: a fresh install has no
 * own alliance, and the tab should be absent rather than link to `#/alliance/null`.
 */
export interface OwnAlliance {
  alliance_id: string;
  name: string | null;
  code: string | null;
}

/** The alliance whose tab is shown: the one being viewed when the account
 * belongs to any (0193), else the first own alliance, which is what a
 * signed-out visitor and every single-alliance install have always seen. */
export function useOwnAlliance(): { data: OwnAlliance | null | undefined } {
  const { active } = useActiveAlliance();
  const fallback = useFirstOwnAlliance(active === null);
  if (active !== null) {
    return { data: { alliance_id: active.alliance_id, name: active.name, code: active.code } };
  }
  return { data: fallback.data };
}

function useFirstOwnAlliance(enabled: boolean) {
  return useQuery({
    queryKey: ['own-alliance'],
    enabled,
    // It names a tab, so it is asked for on every screen. It changes when an
    // admin re-pins the alliance, which is approximately never.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<OwnAlliance | null> => {
      const { data, error } = await supabase
        .from('alliances')
        .select('alliance_id, current_name, current_code')
        .eq('is_own', true)
        // `maybeSingle` would 406 if two alliances were ever pinned. Taking the
        // first is the harmless reading of a state an admin has to fix anyway.
        .limit(1);
      if (error) {
        throw new Error(`own alliance query failed: ${error.message}`);
      }
      const row = data?.[0];
      if (row === undefined) {
        return null;
      }
      return {
        alliance_id: row.alliance_id,
        name: row.current_name,
        code: row.current_code,
      };
    },
  });
}
