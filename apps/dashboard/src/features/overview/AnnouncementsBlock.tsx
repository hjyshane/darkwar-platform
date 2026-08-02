import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

/** Notices an admin wrote, on the screen everyone lands on.
 *
 * The query does not filter by visibility — RLS already did, and repeating
 * the rule in the client would give it two places to be wrong. What comes
 * back is what this reader may see, whoever they are.
 *
 * Expiry IS filtered here rather than in a view: `ends_at > now()` cannot
 * live in an index predicate (now() is not immutable) and a view would hide
 * the rule from the one place that has to explain it.
 */
export interface Announcement {
  announcement_id: string;
  title: string;
  body: string;
  starts_at: string | null;
  ends_at: string | null;
  pinned: boolean;
  visibility: string;
}

async function fetchAnnouncements(): Promise<Announcement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('announcements')
    .select('announcement_id, title, body, starts_at, ends_at, pinned, visibility')
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('pinned', { ascending: false })
    .order('starts_at', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`announcements query failed: ${error.message}`);
  }
  return data ?? [];
}

const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function windowLabel(a: Announcement): string | null {
  if (a.starts_at === null && a.ends_at === null) {
    return null;
  }
  const from = a.starts_at ? when.format(new Date(a.starts_at)) : null;
  const to = a.ends_at ? when.format(new Date(a.ends_at)) : null;
  // UTC throughout, spelled out. The game week resets at 02:00 UTC and the
  // alliance spans eight servers' worth of people in different places; a
  // notice that says "Saturday 2am" in the reader's own zone is the one way
  // to get everybody there at a different time.
  if (from && to) {
    return `${from} – ${to} UTC`;
  }
  return from ? `from ${from} UTC` : `until ${to} UTC`;
}

export function AnnouncementsBlock() {
  const { data, error, isPending } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
  });

  // Nothing to say is not worth a heading and an empty box on the landing
  // screen. An admin who wants to know whether any exist has the settings
  // page for that.
  if (isPending || (data !== undefined && data.length === 0 && error === null)) {
    return null;
  }

  return (
    <section aria-labelledby="announcements-heading">
      <h2 id="announcements-heading">Notices</h2>
      {error && <p className="error">Could not load notices: {error.message}</p>}
      <ul className="notices">
        {(data ?? []).map((item) => (
          <li
            className={item.pinned ? 'notice notice-pinned' : 'notice'}
            key={item.announcement_id}
          >
            <div className="notice-head">
              <strong>{item.title}</strong>
              {item.pinned && <span className="badge badge-fresh">pinned</span>}
              {item.visibility === 'member' && <span className="badge">alliance</span>}
            </div>
            {windowLabel(item) && <div className="subtle">{windowLabel(item)}</div>}
            {/* Plain text, deliberately. The body is whatever an admin typed
                and rendering it as markup would make the notice board the
                one place in this app where a person can inject HTML into
                everyone else's page. pre-wrap keeps their line breaks. */}
            {item.body.trim() !== '' && <p className="notice-body">{item.body}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
