import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { BoardConfig } from './board';

/** Posts you have kept (0116).
 *
 * Stored in `favourites`, the table that already holds starred players,
 * alliances and servers — a scrap is a private shortcut back to something, and
 * that is what 0022 built. Reusing it means the privacy policy, the
 * partial-unique guard and the delete-cascade were all written and tested
 * before this feature existed.
 */
export function scrapsKey(): readonly string[] {
  return ['scraps'];
}

export interface Scraps {
  guideIds: Set<string>;
  announcementIds: Set<string>;
}

/** Everything the reader has scrapped, both boards at once.
 *
 * One query rather than one per board: the row count is "posts this member
 * kept", which is small, and the post page needs to know whether THIS post is
 * in it — a per-board query would still fetch the same table twice.
 */
export function useScraps() {
  return useQuery({
    queryKey: scrapsKey(),
    queryFn: async (): Promise<Scraps> => {
      const { data, error } = await supabase
        .from('favourites')
        .select('guide_id, announcement_id')
        // Own rows only is the policy's job (0022); this narrows to the two
        // post columns so a starred player does not arrive as a null.
        .or('guide_id.not.is.null,announcement_id.not.is.null');
      if (error) {
        throw new Error(`scraps query failed: ${error.message}`);
      }
      const guideIds = new Set<string>();
      const announcementIds = new Set<string>();
      for (const row of data ?? []) {
        if (row.guide_id !== null) {
          guideIds.add(String(row.guide_id));
        }
        if (row.announcement_id !== null) {
          announcementIds.add(String(row.announcement_id));
        }
      }
      return { guideIds, announcementIds };
    },
  });
}

/** Keep a post, or stop keeping it.
 *
 * A DELETE rather than a flag, because that is what the table is: a row exists
 * or it does not. There is deliberately no UPDATE grant on `favourites` — a
 * shortcut is added or removed, never edited.
 */
export function useToggleScrap(config: BoardConfig) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, scrapped }: { postId: string; scrapped: boolean }) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (userId === undefined) {
        return;
      }
      const favourites = supabase.from('favourites');
      if (scrapped) {
        const { error } = await favourites.delete().eq(config.readColumn, postId);
        if (error) {
          throw new Error(error.message);
        }
        return;
      }
      // Spelled out per board rather than with a computed key, the way
      // `useMarkRead` and the comment composer are: `favourites` has a column
      // per target with a check that exactly one is set, and a computed key
      // erases that from the types.
      const { error } =
        config.readColumn === 'guide_id'
          ? await favourites.insert({ user_id: userId, guide_id: postId })
          : await favourites.insert({ user_id: userId, announcement_id: postId });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scrapsKey() });
    },
  });
}
