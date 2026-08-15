import { useQuery } from '@tanstack/react-query';
import { RichTitle } from '../../components/RichText';
import { guideHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';

/** Pinned guides, on the landing screen.
 *
 * PINNED ONLY, like the notices block above it. The front page is not a second
 * copy of the board — it is the handful of things somebody arriving should see
 * without going looking, and on a guides board that grows with every tip
 * anybody writes, "the newest five" would push the ones that actually matter
 * off within a week. Pinning is the editorial decision, and this is where it
 * pays.
 *
 * Published only, for the same reason the notices block filters it: RLS hides
 * a draft from every reader who cannot write one, so this is for the single
 * reader it does not hide it from — the author checking that the front page
 * looks right.
 */
interface PinnedGuide {
  guide_id: string;
  title: string;
  category: string | null;
}

export function GuidesBlock() {
  const { data, error } = useQuery({
    queryKey: ['overview-guides'],
    queryFn: async (): Promise<PinnedGuide[]> => {
      const { data: rows, error: queryError } = await supabase
        .from('guides')
        .select('guide_id, title, category')
        .eq('pinned', true)
        .not('published_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (queryError) {
        throw new Error(`guides query failed: ${queryError.message}`);
      }
      return (rows ?? []) as PinnedGuide[];
    },
  });

  // Nothing pinned is the ordinary state of a young board, and an empty
  // "Guides" heading on the landing screen is furniture. The section goes.
  if (error || data === undefined || data.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="overview-guides-heading">
      <h2 id="overview-guides-heading">Guides</h2>
      <ul className="board-list">
        {data.map((guide) => (
          <li key={guide.guide_id}>
            <a href={guideHash(guide.guide_id)}>
              <RichTitle title={guide.title} />
            </a>
            {guide.category !== null && <span className="post-tag">{guide.category}</span>}
          </li>
        ))}
      </ul>
      <p className="subtle">
        <a href="#/guides">All guides</a>
      </p>
    </section>
  );
}
