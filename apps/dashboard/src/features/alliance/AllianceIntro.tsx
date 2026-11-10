import { useQuery } from '@tanstack/react-query';
import { allianceHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { type KnownAlliance, namedServers, parseIntro } from './allies';
import { fetchAllianceInfo } from './info';
import './alliance.css';

/** The alliance's own words, line for line. An ally tag that resolves to an
 * alliance we know ON THAT SERVER is a link; every other character is text
 * exactly as written, so nothing an alliance typed is reinterpreted. */
export function IntroText({ text, known }: { text: string; known: readonly KnownAlliance[] }) {
  return (
    <div className="intro-text">
      {parseIntro(text, known).map((line, lineIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and never reorder
        <p className="intro-line" key={lineIndex}>
          {line.map((segment, index) =>
            segment.kind === 'ally' && segment.allianceId !== null ? (
              <a
                className="intro-ally"
                href={allianceHash(segment.allianceId)}
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                key={index}
                title={`[${segment.tag}] on ${segment.serverId}`}
              >
                {segment.tag}
              </a>
            ) : segment.kind === 'ally' ? (
              segment.tag
            ) : (
              segment.text
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export interface AllianceIntroViewProps {
  intro: string | null;
  /** Null unless the viewer belongs to the alliance: the view decides that
   * per row (0313), so its presence here is the whole permission check. */
  announce: string | null;
  known: readonly KnownAlliance[];
}

export function AllianceIntroView({ intro, announce, known }: AllianceIntroViewProps) {
  if (intro === null && announce === null) return null;
  return (
    <section aria-label="In the alliance's words" className="alliance-panel">
      {intro !== null && (
        <>
          <h2>Intro</h2>
          <IntroText known={known} text={intro} />
        </>
      )}
      {announce !== null &&
        (intro === null ? (
          <h2>Announcement · members only</h2>
        ) : (
          <h3>Announcement · members only</h3>
        ))}
      {announce !== null && <IntroText known={known} text={announce} />}
    </section>
  );
}

async function fetchKnownAlliances(servers: readonly number[]): Promise<KnownAlliance[]> {
  const { data, error } = await supabase
    .from('alliances')
    .select('alliance_id, server_id, current_code')
    .in('server_id', [...servers])
    .not('current_code', 'is', null)
    .limit(1000);
  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    row.current_code === null
      ? []
      : [{ allianceId: row.alliance_id, serverId: row.server_id, code: row.current_code }],
  );
}

/** Intro and, for its members, the announcement. Shares the header's info
 * read; the tag lookup only runs when the text actually names a server. */
export function AllianceIntro({ allianceId }: { allianceId: string }) {
  const info = useQuery({
    queryKey: ['alliance-info', allianceId],
    queryFn: () => fetchAllianceInfo(allianceId),
  });
  const intro = info.data?.intro ?? null;
  const announce = info.data?.announce ?? null;
  const servers = namedServers(`${intro ?? ''}\n${announce ?? ''}`);
  const known = useQuery({
    queryKey: ['alliance-tags', servers],
    queryFn: () => fetchKnownAlliances(servers),
    enabled: servers.length > 0,
  });
  return <AllianceIntroView announce={announce} intro={intro} known={known.data ?? []} />;
}
