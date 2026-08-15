import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';

/** The event standings, on the landing screen (0120).
 *
 * PUBLIC TO THE ALLIANCE, which is the opposite of the admin activity table
 * and deliberately so: people enter an event knowing there is a scoreboard,
 * and one only the admin can see is not a scoreboard. The view behind this
 * carries a name and a number and nothing else — no per-day rows, no breakdown
 * of which boards somebody opened.
 *
 * The window is 15 Aug 02:00 to 23 Aug 01:59 UTC, fixed in the view because
 * the event has real dates.
 */
const EVENT_ENDS = Date.UTC(2026, 7, 23, 1, 59);
const EVENT_LABEL = '15–23 August';

interface Standing {
  displayName: string | null;
  points: number;
}

function useScoreboard() {
  return useQuery({
    queryKey: ['event-scoreboard'],
    queryFn: async (): Promise<Standing[]> => {
      const { data, error } = await supabase
        .from('event_scoreboard')
        .select('display_name, points')
        .order('points', { ascending: false });
      if (error) {
        throw new Error(`scoreboard query failed: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        displayName: (row.display_name as string | null) ?? null,
        points: Number(row.points ?? 0),
      }));
    },
  });
}

/** Write the final standings into a notice DRAFT.
 *
 * A draft, not a published notice, and that is the whole point of the button.
 * Publishing is what reaches Discord (0108), so an automatic post would
 * announce unreviewed wording to everybody; this puts the table in the editor
 * and leaves the decision where it belongs.
 */
function useArchive(standings: readonly Standing[]) {
  return useMutation({
    mutationFn: async () => {
      const body = [
        `Final standings for the ${EVENT_LABEL} event.`,
        '',
        ...standings.map(
          (standing, index) =>
            `${index + 1}. ${standing.displayName ?? '—'} — ${standing.points} points`,
        ),
      ].join('\n');
      const { error } = await supabase
        .from('announcements')
        // `published_at` left null on purpose: null is a draft (0108).
        .insert({ title: `Event results — ${EVENT_LABEL}`, body, visibility: 'member' });
      if (error) {
        throw new Error(error.message);
      }
    },
  });
}

export function EventScoreboard() {
  const { data, error } = useScoreboard();
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const [archived, setArchived] = useState(false);
  const standings = data ?? [];
  const archive = useArchive(standings);

  // No loading state and no error box. This is an extra on the landing screen;
  // a red panel about a scoreboard would be worse than its absence, and the
  // block disappearing while it loads is less alarming than one that flashes.
  if (error || standings.length === 0) {
    return null;
  }

  const ended = Date.now() > EVENT_ENDS;
  const mayArchive = isAllowed(
    permissions?.grants,
    session?.role ?? 'viewer',
    'announcement.write',
  );

  return (
    <section aria-labelledby="event-heading">
      <h2 id="event-heading">
        Event scoreboard
        <span className="post-tag">{EVENT_LABEL}</span>
      </h2>
      <ol className="event-board">
        {standings.map((standing, index) => (
          <li key={`${standing.displayName ?? 'unnamed'}-${index}`}>
            <span className="event-rank">{index + 1}</span>
            {/* A dash, never "Unknown" — an entrant with no character linked is
                somebody we genuinely cannot name (0113). */}
            <span className="post-author">{standing.displayName ?? '—'}</span>
            <span className="event-points">{standing.points}</span>
          </li>
        ))}
      </ol>
      {/* Only once it is over, and only for somebody who may post a notice.
          Before the end the standings are still moving and an archive of them
          would be wrong the next morning. */}
      {ended && mayArchive && (
        <p>
          <button
            disabled={archive.isPending || archived}
            onClick={() => archive.mutate(undefined, { onSuccess: () => setArchived(true) })}
            type="button"
          >
            {archived ? 'Saved as a notice draft' : 'Archive to the notice board'}
          </button>
          {archive.error !== null && <span className="error">{archive.error.message}</span>}
        </p>
      )}
    </section>
  );
}
