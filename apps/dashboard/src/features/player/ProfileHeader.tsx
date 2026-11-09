import type { ReactNode } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Cell, CellGrid } from '../../components/console/Cell';
import { Chip } from '../../components/console/Chip';
import { Led } from '../../components/console/Led';
import { Ticks } from '../../components/console/Ticks';
import { Verdict } from '../../components/console/Verdict';
import { leagueLabel } from '../../lib/arenaLeague';
import { compactNumber } from '../../lib/compactNumber';
import { allianceHash, mapHash, serverHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { LineupCell } from '../arena/LineupCell';
import type { CellModel, HeaderModel } from './headerModel';
import './profileHeader.css';

export interface ProfileHeaderProps {
  /** The name, or `UID …` for a player we have never seen named. */
  name: string;
  gameUid: number;
  serverId: number;
  alliance: { id: string; code: string | null; name: string | null } | null;
  hqLevel: number | null;
  lastSeenAt: string | null;
  model: HeaderModel;
  /** The favourite toggle, when somebody is signed in. */
  favourite?: ReactNode;
  /** Present when there is a sighting to draw: the coordinate becomes the
   * control that opens the player's own map. */
  onToggleMap?: () => void;
  mapOpen?: boolean;
  /** The opened map and its note, placed under the cells. */
  mapSlot?: ReactNode;
  /** Switches the page to the Arena tab, which keeps every entry. */
  onShowArena?: () => void;
  now?: Date;
}

const power = compactNumber(1);

function cellOf(model: CellModel, hero = false) {
  return (
    <Cell
      context={model.context}
      hero={hero}
      label={model.label}
      tone={model.tone}
      unit={model.unit}
      value={model.value}
    />
  );
}

/** The reading at the top of a player page: who, how strong against their
 * server, where the power sits, whether they are exposed right now.
 *
 * Presentational. `buildHeaderModel` decided every word and tone; this places
 * them on the console kit. A section whose data is missing is absent — there
 * is no empty composition and no "no lineups" placeholder. */
export function ProfileHeader({
  name,
  gameUid,
  serverId,
  alliance,
  hqLevel,
  lastSeenAt,
  model,
  favourite,
  onToggleMap,
  mapOpen,
  mapSlot,
  onShowArena,
  now,
}: ProfileHeaderProps) {
  const { position } = model;
  // Keyed by position in the sentence: segments are composed, never reordered.
  const verdict = model.verdict.map((segment, at) => ({ ...segment, at }));

  return (
    <section aria-labelledby="player-heading" className="entity profile-header">
      <header className="profile-identity">
        <div className="profile-who">
          <h2 id="player-heading">
            {favourite}
            {name}
          </h2>
          <p className="entity-meta">
            <a href={serverHash(serverId)}>Server {serverId}</a>
            {alliance && (
              <a href={allianceHash(alliance.id)}>
                {alliance.code ? `[${alliance.code}] ` : ''}
                {alliance.name ?? 'alliance'}
              </a>
            )}
            {hqLevel !== null && (
              <span>
                {TERMS.hq} {hqLevel}
              </span>
            )}
          </p>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: three status lights are a group, not a form fieldset */}
        <div aria-label="Status" className="profile-leds" role="group">
          {model.leds.map((led) => (
            <Led key={led.key} title={led.title} tone={led.tone}>
              {led.text}
            </Led>
          ))}
        </div>
      </header>

      {verdict.length > 0 && (
        <div className="profile-verdict">
          <Verdict>
            {verdict.map((segment) =>
              segment.kind === 'figure' ? (
                <code key={segment.at}>{segment.text}</code>
              ) : (
                <span key={segment.at}>{segment.text}</span>
              ),
            )}
          </Verdict>
        </div>
      )}

      <div className="profile-cells">
        <CellGrid>
          {cellOf(model.power, true)}
          {cellOf(model.rank)}
          <Cell
            context={
              position.serverId === null ? (
                position.context
              ) : (
                <a href={mapHash(position.serverId)} title="Open this server's map">
                  {position.context}
                </a>
              )
            }
            label={position.label}
            value={
              position.value !== null && onToggleMap ? (
                // The coordinate IS the control: the number is what somebody is
                // already looking at when they want to see where it is.
                <button
                  aria-expanded={mapOpen === true}
                  className="linklike"
                  onClick={onToggleMap}
                  type="button"
                >
                  {position.value}
                </button>
              ) : (
                position.value
              )
            }
          />
          {cellOf(model.kills)}
          {cellOf(model.lastSeen)}
          {cellOf(model.sixth)}
        </CellGrid>
      </div>

      {mapSlot && <div className="profile-map">{mapSlot}</div>}

      {model.ticks.length > 0 && (
        <div className="profile-block profile-composition">
          <h3 className="profile-label">
            Power composition
            {model.boardsAsOf && <span> · as of {model.boardsAsOf}</span>}
          </h3>
          <Ticks ariaLabel="Power composition" items={model.ticks} />
        </div>
      )}

      {model.lineups.length > 0 && (
        <div className="profile-block profile-lineups">
          <h3 className="profile-label">Lineups seen in arena</h3>
          {model.lineups.map((entry) => (
            <div className="profile-lineup" key={entry.entryId}>
              <div className="profile-lineup-head">
                <span className="profile-lineup-league">{leagueLabel(entry.league)}</span>
                {/* The source, said plainly: this is the defence they posted on
                    an arena board, not a squad seen in battle. */}
                <span className="profile-lineup-seen">
                  Seen in arena · {entry.capturedAt.slice(0, 10)}
                </span>
                {entry.defensePower !== null && (
                  <Chip figure={power.format(entry.defensePower)} label={TERMS.defensePower} />
                )}
              </div>
              {entry.lineup.length === 0 ? (
                // An entry with no `army` is not an entry with an empty defence.
                <p className="subtle">No lineup was captured with this entry.</p>
              ) : (
                <LineupCell heroes={entry.lineup} />
              )}
            </div>
          ))}
          {onShowArena && (
            <p className="profile-more">
              <button className="linklike" onClick={onShowArena} type="button">
                All arena entries
              </button>
            </p>
          )}
        </div>
      )}

      <p className="entity-foot">
        UID {gameUid} · {TERMS.lastSeen} <FreshnessBadge capturedAt={lastSeenAt} now={now} />
      </p>
    </section>
  );
}
