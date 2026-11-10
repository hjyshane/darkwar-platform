import { useQuery } from '@tanstack/react-query';
import { Cell, CellGrid } from '../../components/console/Cell';
import { Led } from '../../components/console/Led';
import { Verdict } from '../../components/console/Verdict';
import { compactNumber } from '../../lib/compactNumber';
import { playerHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { countryName, languageName } from './codes';
import {
  type PowerReading,
  captureLed,
  fetchLeader,
  fetchPowerReadings,
  fetchStanding,
  powerDelta,
  rosterLed,
  signedCompact,
} from './header';
import { type AllianceInfo, fetchAllianceInfo, joinRuleOf } from './info';
import {
  type AllianceVerdictFacts,
  type StandingRow,
  standingFacts,
  standingGap,
  verdictParts,
} from './verdict';
import './alliance.css';

const compact = compactNumber(1);
const plain = new Intl.NumberFormat('en');

export interface AllianceHeaderViewProps {
  allianceId: string;
  serverId: number;
  /** As the ranking screen reports them, from the page's own query. */
  power: number | null;
  memberCount: number | null;
  /** How many members we have actually seen, and from where. */
  observed: number;
  membersFrom: 'roster' | 'last known';
  rosterCapturedAt: string | null;
  rosterComplete: boolean;
  /** Null for an alliance nobody has opened in the client, which is most. */
  info: AllianceInfo | null;
  standing: readonly StandingRow[] | null;
  readings: readonly PowerReading[] | null;
  now: Date;
}

/** The first screenful: two status lights, the verdict, six figures.
 *
 * Every clause and every cell stands on its own data and drops to a dash
 * without it, so an alliance we know only from the ranking still gets its
 * power, its place and its member count, and nothing invented beside them. */
export function AllianceHeaderView({
  allianceId,
  serverId,
  power,
  memberCount,
  observed,
  membersFrom,
  rosterCapturedAt,
  rosterComplete,
  info,
  standing,
  readings,
  now,
}: AllianceHeaderViewProps) {
  const facts: AllianceVerdictFacts = {
    ...standingFacts(standing ?? [], allianceId),
    serverId,
    joinRule: info === null ? null : joinRuleOf(info),
    minPower: info?.min_power ?? null,
    minHq: info?.min_hq ?? null,
  };
  const parts = verdictParts(facts);
  const leds = [rosterLed(rosterCapturedAt, now), captureLed(membersFrom, rosterComplete)].filter(
    (led) => led !== null,
  );
  const delta = powerDelta(readings ?? [], now);
  const minimums = [
    info?.min_power != null ? compact.format(info.min_power) : null,
    info?.min_hq != null ? `${TERMS.hq} ${info.min_hq}` : null,
  ].filter((part) => part !== null);

  return (
    <>
      {leds.length > 0 && (
        <p className="alliance-leds">
          {leds.map((led) => (
            <Led key={led.text} title={led.title} tone={led.tone}>
              {led.text}
            </Led>
          ))}
        </p>
      )}
      {parts.length > 0 && (
        <div className="alliance-verdict">
          <Verdict>
            {parts.map((part, index) =>
              part.kind === 'figure' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reorder
                <code key={index}>{part.text}</code>
              ) : (
                part.text
              ),
            )}
          </Verdict>
        </div>
      )}
      <CellGrid columns={3}>
        <Cell
          context={delta === null ? undefined : `${signedCompact(delta)} in 7d`}
          hero
          label={TERMS.power}
          tone={delta === null || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down'}
          value={power === null ? null : compact.format(power)}
        />
        <Cell
          context={standingGap(facts) ?? undefined}
          label="Rank on server"
          unit={facts.total === null ? undefined : `/${facts.total}`}
          value={facts.rank === null ? null : `#${facts.rank}`}
        />
        <Cell
          context={observed > 0 ? `${plain.format(observed)} observed` : 'none observed'}
          label={TERMS.members}
          note={
            membersFrom === 'last known' && observed > 0
              ? 'last known alliance, not cleared when somebody leaves'
              : undefined
          }
          unit={info?.max_members != null ? `/${info.max_members}` : undefined}
          value={memberCount === null ? null : plain.format(memberCount)}
        />
        {/* The raw integer under an honest label: whether 1 means "needs
            approval" or "open join" is unconfirmed (0313 column comment). */}
        <Cell
          context={info?.join_approval != null ? 'meaning unconfirmed' : undefined}
          label="Join (raw)"
          value={info?.join_approval ?? null}
        />
        <Cell label="Minimums" value={minimums.length > 0 ? minimums.join(' · ') : null} />
        {/* Words, not a figure: smaller, and wrapping at spaces instead of
            mid-word like the kit's figures do. */}
        <Cell
          classNames={{ value: 'cell-value-words' }}
          context={countryName(info?.country ?? null) ?? undefined}
          label="Language"
          value={languageName(info?.language ?? null)}
        />
      </CellGrid>
    </>
  );
}

export interface AllianceHeaderProps {
  allianceId: string;
  serverId: number;
  power: number | null;
  memberCount: number | null;
  observed: number;
  membersFrom: 'roster' | 'last known';
  rosterCapturedAt: string | null;
  rosterComplete: boolean;
  now?: Date;
}

/** The header with its three extra reads. None of them gates the page: a
 * failed or empty read leaves its cells on a dash, and the detail query the
 * page already made carries power and members. */
export function AllianceHeader({ now, ...detail }: AllianceHeaderProps) {
  const info = useQuery({
    queryKey: ['alliance-info', detail.allianceId],
    queryFn: () => fetchAllianceInfo(detail.allianceId),
  });
  const standing = useQuery({
    queryKey: ['alliance-standing', detail.serverId],
    queryFn: () => fetchStanding(detail.serverId),
  });
  const readings = useQuery({
    queryKey: ['alliance-power-readings', detail.allianceId],
    queryFn: () => fetchPowerReadings(detail.allianceId),
  });
  return (
    <AllianceHeaderView
      {...detail}
      info={info.data ?? null}
      now={now ?? new Date()}
      readings={readings.data ?? null}
      standing={standing.data ?? null}
    />
  );
}

/** "Leader <name>" for the identity line. get.al.info names the leader by game
 * uid; nothing renders until that resolves to a player we know. */
export function AllianceLeader({ allianceId }: { allianceId: string }) {
  const info = useQuery({
    queryKey: ['alliance-info', allianceId],
    queryFn: () => fetchAllianceInfo(allianceId),
  });
  const uid = info.data?.leader_game_uid ?? null;
  const leader = useQuery({
    queryKey: ['alliance-leader', uid],
    queryFn: () => (uid === null ? null : fetchLeader(uid)),
    enabled: uid !== null,
  });
  if (leader.data === null || leader.data === undefined) return null;
  return (
    <span>
      Leader <a href={playerHash(leader.data.playerId)}>{leader.data.name ?? '—'}</a>
    </span>
  );
}
