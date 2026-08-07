import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { AllianceCompare } from './AllianceCompare';
import { AllianceMemberTable } from './AllianceMemberTable';
import { AllianceTrends } from './AllianceTrends';

/** One alliance: what the game reports about it, and who we have seen in it.
 *
 * The two are separate on purpose and the page says so. `alliances` carries
 * what the ranking screen reported for the whole alliance; the member list
 * below is whoever a roster capture has actually put in it, which for an
 * alliance that is not ours is usually nobody. Presenting the game's member
 * count above an empty list without explaining the gap would read as a bug.
 *
 * WHERE THE MEMBER LIST COMES FROM, and why it is two queries.
 *
 * `players.current_alliance_id` is a LAST KNOWN alliance, not a current one —
 * every writer since 0008 coalesces it, so nothing ever clears it and a member
 * who leaves keeps the badge. Counting it reported 95 for an alliance the game
 * says has 94, and the extra row was someone last seen in a roster batch on
 * 2026-07-28 and in none of the ~180 since.
 *
 * So the roster batch wins where there is one: `alliance_roster_latest` (0067)
 * is the newest `al.rank` response, and one of those is the whole roster. The
 * fallback still matters — that view is member-gated and only ever populated
 * for our own alliance, so for everybody else's, `players` is the only link
 * there is and a stale badge is better than an empty page.
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
    /** Null for a roster row whose uid never resolved to a `players` row —
     * nullable on the base table since 0003. They are still a member and still
     * count; there is just nothing to link to yet. */
    playerId: string | null;
    name: string | null;
    gameUid: number;
    power: number | null;
    hqLevel: number | null;
  }[];
  /** Whether `members` is the newest roster batch or the coalesced badge on
   * `players`. The page says which, because the second one can name somebody
   * who left and there is no way to tell from the row itself. */
  membersFrom: 'roster' | 'last known';
  /** Only for a roster list: how much of it the newest batch actually saw. A
   * capture that was not scrolled to the end is short, and a short batch looks
   * exactly like a mass departure. */
  rosterCapturedAt: string | null;
  rosterComplete: boolean;
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

  // Both member sources at once. The roster is preferred where it has rows;
  // asking for the fallback anyway costs one round trip against a query the
  // page was already making, and sequencing them would put a second wait in
  // front of every alliance that is not ours — which is nearly all of them.
  const [{ data: roster, error: rosterError }, { data: members, error: memberError }] =
    await Promise.all([
      // Empty here is the ordinary case, not an error: the view is member-gated
      // and only our own alliance has ever had its member list opened, so a
      // signed-out reader and every other alliance both land on nothing.
      supabase
        .from('alliance_roster_latest')
        .select('player_id, game_uid, name, power, hq_level, captured_at, snapshot_complete')
        .eq('alliance_id', allianceId)
        .order('power', { ascending: false, nullsFirst: false })
        .limit(200),
      supabase
        .from('players')
        .select('player_id, current_name, game_uid, power, hq_level')
        .eq('current_alliance_id', allianceId)
        .order('power', { ascending: false, nullsFirst: false })
        .limit(100),
    ]);
  if (rosterError) {
    throw new Error(`roster query failed: ${rosterError.message}`);
  }
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

  // Held as a row rather than re-indexing: `roster[0]` is `| undefined` to the
  // type checker at every use, and narrowing it once is clearer than three
  // assertions that all mean the same thing.
  const newestBatch = roster?.[0] ?? null;
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
    members:
      newestBatch === null
        ? (members ?? []).map((row) => ({
            playerId: row.player_id,
            name: row.current_name,
            gameUid: row.game_uid,
            power: row.power,
            hqLevel: row.hq_level,
          }))
        : (roster ?? []).map((row) => ({
            playerId: row.player_id,
            name: row.name,
            // Not null on the base table; the view widens every column, so the
            // fallback is for the type checker and never for a real row.
            gameUid: row.game_uid ?? 0,
            power: row.power,
            hqLevel: row.hq_level,
          })),
    membersFrom: newestBatch === null ? 'last known' : 'roster',
    rosterCapturedAt: newestBatch?.captured_at ?? null,
    // One batch, one flag: every row of an `al.rank` response shares its
    // `captured_at` and therefore its completeness, so this reads the first row
    // rather than and-ing across them — which would only mask a bug in 0067.
    // Null means the alliance has no member count to measure against, which 0067
    // treats as unmeasured rather than incomplete.
    rosterComplete: newestBatch?.snapshot_complete ?? true,
    // Both halves compared, not just the name. An alliance keeping its name
    // and changing its tag is a rename people notice, and filtering on the
    // name alone would drop exactly that row.
    pastNames: (names ?? [])
      .filter((row) => row.name !== alliance.current_name || row.code !== alliance.current_code)
      .map((row) => ({ name: row.name, code: row.code, lastSeenAt: row.last_seen_at })),
  };
}

/** The three questions this page answers, in the order they get asked: who is
 * in it, how has it moved, how does it compare. Members first because that is
 * what the page has always opened on and a link from elsewhere expects it. */
type View = 'members' | 'trends' | 'compare';

const VIEWS: { view: View; label: string }[] = [
  { view: 'members', label: 'Members' },
  { view: 'trends', label: 'Trends' },
  { view: 'compare', label: 'Against the server' },
];

const plain = new Intl.NumberFormat('ko-KR');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function num(value: number | null): string | null {
  return value === null ? null : plain.format(value);
}

function big(value: number | null): string | null {
  return value === null ? null : compact.format(value);
}

export function AlliancePage({ allianceId, now }: { allianceId: string; now?: Date }) {
  const [view, setView] = useState<View>('members');
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
            note={
              data.membersFrom === 'roster'
                ? 'the newest roster capture'
                : 'last known alliance, which is not cleared when somebody leaves'
            }
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
        {/* A short batch and a mass departure look identical from the rows
            alone, so 0067 measures the batch against the game's own count and
            this repeats the verdict. Without it, a capture that was not
            scrolled to the end reads as members having left. */}
        {data.membersFrom === 'roster' && !data.rosterComplete && (
          <p className="empty">
            The newest roster capture saw {data.members.length} of the {num(data.memberCount)} the
            game reports, so it was cut short rather than finished — anybody missing from this list
            may simply not have been scrolled to.
          </p>
        )}
      </section>

      {/* Buttons, not links, and local state rather than a hash segment.
          Switching view is not navigation here: every tab is about the same
          alliance and the back button should leave the page, not step through
          three panels. The markup and `aria-current` match the main nav so the
          selected state cannot look different from the rest of the app. */}
      <nav aria-label="Alliance views" className="tabs subtabs">
        {VIEWS.map((entry) => (
          <button
            key={entry.view}
            aria-current={entry.view === view ? 'page' : undefined}
            className="tab"
            onClick={() => setView(entry.view)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {view === 'trends' && (
        <section aria-labelledby="alliance-trends">
          <h2 id="alliance-trends">Trends</h2>
          <AllianceTrends allianceId={data.allianceId} isOwn={data.isOwn} />
        </section>
      )}

      {view === 'compare' && (
        <section aria-labelledby="alliance-compare">
          <h2 id="alliance-compare">Against the server</h2>
          <AllianceCompare serverId={data.serverId} />
        </section>
      )}

      {view === 'members' && (
        <section aria-labelledby="alliance-members">
          <h2 id="alliance-members">{TERMS.members}</h2>
          {data.members.length === 0 ? (
            // The common case for someone else's alliance, and worth saying
            // rather than showing an empty table: the game gives a member COUNT
            // on the ranking screen but the names only come from opening that
            // alliance's roster, which we can only do for our own.
            <p className="empty">
              No member of this alliance has been observed. The ranking screen reports how many
              there are; the names come from a roster capture.
            </p>
          ) : (
            <AllianceMemberTable members={data.members} />
          )}
        </section>
      )}

      {view === 'members' && data.pastNames.length > 0 && (
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
