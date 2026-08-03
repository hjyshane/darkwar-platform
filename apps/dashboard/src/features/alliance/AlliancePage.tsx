import { useQuery } from '@tanstack/react-query';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { playerHash, serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';

/** One alliance: what the game reports about it, and who we have seen in it.
 *
 * The two are separate on purpose and the page says so. `alliances` carries
 * what the ranking screen reported for the whole alliance; the member list
 * below is whoever a roster capture has actually put in it, which for an
 * alliance that is not ours is usually nobody. Presenting the game's member
 * count above an empty list without explaining the gap would read as a bug.
 */
interface AllianceDetail {
  allianceId: string;
  name: string | null;
  code: string | null;
  serverId: number;
  power: number | null;
  memberCount: number | null;
  isOwn: boolean;
  rosterUnredactedSeen: boolean;
  lastSeenAt: string | null;
  members: {
    playerId: string;
    name: string | null;
    gameUid: number;
    power: number | null;
    hqLevel: number | null;
  }[];
  /** What this alliance used to be called. `alliance_names` has been filled
   * by apply_alliance_summary since 0008 and nothing read it — the player
   * page has shown `player_names` all along, and an alliance renames for the
   * same reasons a player does. */
  pastNames: { name: string; code: string | null; lastSeenAt: string }[];
}

async function fetchAlliance(allianceId: string): Promise<AllianceDetail | null> {
  const { data: alliance, error } = await supabase
    .from('alliances')
    .select(
      'alliance_id, current_name, current_code, server_id, power, member_count, is_own, roster_unredacted_seen, last_seen_at',
    )
    .eq('alliance_id', allianceId)
    .maybeSingle();
  if (error) {
    throw new Error(`alliance query failed: ${error.message}`);
  }
  if (alliance === null) {
    return null;
  }

  const { data: members, error: memberError } = await supabase
    .from('players')
    .select('player_id, current_name, game_uid, power, hq_level')
    .eq('current_alliance_id', allianceId)
    .order('power', { ascending: false, nullsFirst: false })
    .limit(100);
  if (memberError) {
    throw new Error(`member query failed: ${memberError.message}`);
  }

  const { data: names, error: nameError } = await supabase
    .from('alliance_names')
    .select('name, code, last_seen_at')
    .eq('alliance_id', allianceId)
    .order('last_seen_at', { ascending: false });
  if (nameError) {
    throw new Error(`alliance name query failed: ${nameError.message}`);
  }

  return {
    allianceId: alliance.alliance_id,
    name: alliance.current_name,
    code: alliance.current_code,
    serverId: alliance.server_id,
    power: alliance.power,
    memberCount: alliance.member_count,
    isOwn: alliance.is_own,
    rosterUnredactedSeen: alliance.roster_unredacted_seen,
    lastSeenAt: alliance.last_seen_at,
    members: (members ?? []).map((row) => ({
      playerId: row.player_id,
      name: row.current_name,
      gameUid: row.game_uid,
      power: row.power,
      hqLevel: row.hq_level,
    })),
    // Both halves compared, not just the name. An alliance keeping its name
    // and changing its tag is a rename people notice, and filtering on the
    // name alone would drop exactly that row.
    pastNames: (names ?? [])
      .filter((row) => row.name !== alliance.current_name || row.code !== alliance.current_code)
      .map((row) => ({ name: row.name, code: row.code, lastSeenAt: row.last_seen_at })),
  };
}

const plain = new Intl.NumberFormat('ko-KR');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function num(value: number | null): string | null {
  return value === null ? null : plain.format(value);
}

function big(value: number | null): string | null {
  return value === null ? null : compact.format(value);
}

export function AlliancePage({ allianceId, now }: { allianceId: string; now?: Date }) {
  const { signedIn, isFavourite, toggle } = useFavourites();
  const { data, error, isPending } = useQuery({
    queryKey: ['alliance', allianceId],
    queryFn: () => fetchAlliance(allianceId),
  });

  if (isPending) {
    return (
      <main>
        <p className="empty">Loading…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main>
        <p className="error">Could not load the alliance: {error.message}</p>
      </main>
    );
  }
  if (data === null || data === undefined) {
    return (
      <main>
        <p className="empty">No alliance with that id. It may never have been observed.</p>
      </main>
    );
  }

  const label = `${data.code ? `[${data.code}] ` : ''}${data.name ?? 'Unnamed alliance'}`;
  return (
    <main>
      <section aria-labelledby="alliance-heading">
        <h2 id="alliance-heading">
          {signedIn && (
            <FavouriteButton
              id={data.allianceId}
              isFavourite={isFavourite('alliance', data.allianceId)}
              kind="alliance"
              label={label}
              onToggle={toggle}
            />
          )}
          {label}
          <span className="subtle">
            {' · '}
            <a href={serverHash(data.serverId)}>server {data.serverId}</a>
            {data.isOwn && ' · ours'}
          </span>
        </h2>

        <div className="stats">
          <StatTile
            hero
            label={TERMS.power}
            note="as the game reports it"
            value={big(data.power)}
          />
          <StatTile
            label={TERMS.members}
            note="as the game reports it"
            value={num(data.memberCount)}
          />
          <StatTile
            label="Members observed"
            note="whoever a roster capture has put here"
            value={num(data.members.length === 0 ? null : data.members.length)}
          />
        </div>
        <p className="subtle">
          {TERMS.lastSeen} <FreshnessBadge capturedAt={data.lastSeenAt} now={now} />
          {data.isOwn && !data.rosterUnredactedSeen && (
            <>
              {' · '}
              <strong>pinned by an admin</strong>, not by evidence — no unredacted roster for it
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="alliance-members">
        <h2 id="alliance-members">{TERMS.members}</h2>
        {data.members.length === 0 ? (
          // The common case for someone else's alliance, and worth saying
          // rather than showing an empty table: the game gives a member COUNT
          // on the ranking screen but the names only come from opening that
          // alliance's roster, which we can only do for our own.
          <p className="empty">
            No member of this alliance has been observed. The ranking screen reports how many there
            are; the names come from a roster capture.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="label">{TERMS.name}</th>
                  <th className="num">{TERMS.hq}</th>
                  <th className="num">{TERMS.power}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.playerId}>
                    <td className="label">
                      <a href={playerHash(member.playerId)}>
                        {member.name ?? `UID ${member.gameUid}`}
                      </a>
                    </td>
                    <td className="num">{member.hqLevel ?? '—'}</td>
                    <td className="num">{num(member.power) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.pastNames.length > 0 && (
        <section aria-labelledby="alliance-names">
          <h2 id="alliance-names">Also known as</h2>
          {/* The player page has shown player_names since it existed and the
              alliance side was simply never built. Same reason it matters:
              a name is not an identity, and somebody searching for an
              alliance that renamed has nothing else to go on.

              A table rather than the badges the player page uses, because
              there are three facts here — a tag can change while the name
              does not, and badges would flatten that into a repeat. */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="label" scope="col">
                    {TERMS.name}
                  </th>
                  <th scope="col">Tag</th>
                  <th scope="col">Last seen as this</th>
                </tr>
              </thead>
              <tbody>
                {data.pastNames.map((row) => (
                  <tr key={`${row.name}:${row.code ?? ''}`}>
                    <td className="label">{row.name}</td>
                    {/* Null is a capture that carried no tag, not an alliance
                        without one. */}
                    <td>{row.code === null ? '—' : `[${row.code}]`}</td>
                    <td title={row.lastSeenAt}>{row.lastSeenAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
