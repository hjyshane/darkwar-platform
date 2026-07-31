import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useSession } from './useSession';

export type FavouriteKind = 'player' | 'alliance' | 'server';

const COLUMN: Record<FavouriteKind, 'player_id' | 'alliance_id' | 'server_id'> = {
  player: 'player_id',
  alliance: 'alliance_id',
  server: 'server_id',
};

/** The signed-in user's shortcuts, as sets keyed by kind.
 *
 * One query for the whole list rather than one per row: it is a handful of
 * rows per person, and asking per row would put a request behind every star
 * in a hundred-row table.
 *
 * Signed out there is nothing to fetch — RLS would return an empty list
 * anyway, but skipping the request keeps the logged-out dashboard to the
 * queries it actually needs.
 */
export function useFavourites() {
  const { data: session } = useSession();
  const signedIn = session?.email != null;
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['favourites'],
    enabled: signedIn,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('favourites')
        .select('favourite_id, player_id, alliance_id, server_id');
      if (error) {
        throw new Error(`favourites query failed: ${error.message}`);
      }
      return rows;
    },
  });

  const rows = data ?? [];
  const ids = {
    player: new Set(rows.map((r) => r.player_id).filter((v) => v !== null)),
    alliance: new Set(rows.map((r) => r.alliance_id).filter((v) => v !== null)),
    server: new Set(rows.map((r) => r.server_id).filter((v) => v !== null)),
  };

  const toggle = useMutation({
    mutationFn: async ({ kind, id }: { kind: FavouriteKind; id: string | number }) => {
      const existing = rows.find((row) => row[COLUMN[kind]] === id);
      if (existing) {
        const { error } = await supabase
          .from('favourites')
          .delete()
          .eq('favourite_id', existing.favourite_id);
        if (error) {
          throw new Error(error.message);
        }
        return;
      }
      // user_id is set here and checked again by RLS. The policy is what
      // makes it true; this only saves a round trip to find out.
      const { data: auth } = await supabase.auth.getSession();
      const userId = auth.session?.user.id;
      if (userId === undefined) {
        throw new Error('not signed in');
      }
      // Each literal is handed to insert() where it is written, rather than
      // built first and passed in. A computed key widens to
      // `string | number` on every column; a union of three shapes trips the
      // generated types' excess-property check. Written out, each one is
      // checked against the Insert type it actually is — so a player id
      // cannot end up in server_id.
      const table = supabase.from('favourites');
      const { error } =
        kind === 'player'
          ? await table.insert({ user_id: userId, player_id: String(id) })
          : kind === 'alliance'
            ? await table.insert({ user_id: userId, alliance_id: String(id) })
            : await table.insert({ user_id: userId, server_id: Number(id) });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favourites'] }),
  });

  return {
    signedIn,
    isFavourite: (kind: FavouriteKind, id: string | number) =>
      (ids[kind] as Set<string | number>).has(id),
    toggle: (kind: FavouriteKind, id: string | number) => toggle.mutate({ kind, id }),
    count: (kind: FavouriteKind) => ids[kind].size,
  };
}
