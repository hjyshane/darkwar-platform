import { useState } from 'react';
import { shareCoordinate } from '../../lib/shareCoordinate';
import { SERVER_ZONE, browserZone, zonedDayKey, zonedTime } from '../../lib/timezone';
import { useSession } from '../../lib/useSession';
import { KIND_OPTIONS } from '../calculator/model';
import {
  CALCULATOR_KINDS,
  type CalculatorKind,
  DEFAULT_STATE,
  calculatorHash,
} from '../calculator/url';
import { useCapturedTimes, useEventGuide } from '../eventGuide/data';
import { WEEKDAYS } from '../eventGuide/guide';
import { HiveSnapshot } from '../hive/HiveSnapshot';
import { useBoard, useFormations } from '../hive/hiveFormations';
import { AnnouncementsBlock } from '../overview/AnnouncementsBlock';
import { GuidesBlock } from '../overview/GuidesBlock';
import { useMyBlackGold, useMyPlayer } from './homeData';
import { blackGoldLine, nextBlackGold, todaysDuel } from './homeModel';

/** Where every signed-in member lands (owner, 2026-11-18): this week on one
 * screen. Design: docs/superpowers/specs/2026-11-18-member-home-design.md.
 *
 * Four cards, the one a member needs right now first: where my base goes, what
 * runs this week, what to upgrade (with the calculator), what the officers
 * pinned. No gift-code card (owner). */
export function HomePage() {
  const { data: session } = useSession();
  const playerId = session?.playerId ?? null;
  const me = useMyPlayer(playerId);
  const nowIso = new Date().toISOString();
  const localZone = browserZone();
  const showLocal = hasOwnClock(localZone, nowIso);

  return (
    <section aria-labelledby="home-heading" className="home">
      <header className="home-head">
        <h2 id="home-heading">Home</h2>
        <p className="subtle">
          {me.data?.name ?? (playerId === null ? 'No character linked' : '…')}
          {me.data ? ` · Server ${me.data.serverId}` : ''} · {zonedTime(nowIso, SERVER_ZONE)} server
          time
          {showLocal && ` · ${zonedTime(nowIso, localZone)} your time`}
        </p>
      </header>
      {playerId === null && (
        <p className="empty">
          Link your account to your character on <a href="#/account">My account</a> to see your tile
          and your Black Gold team here.
        </p>
      )}
      {/* Pinned notices first, as tight one-line rows (owner, 2026-11-19): what
          the officers want read comes before anything else, without pushing
          the tile below the fold. The block draws nothing when none is pinned. */}
      <div className="home-notices">
        <AnnouncementsBlock />
      </div>
      <HiveCard playerId={playerId} />
      <WeekCard playerId={playerId} />
      <UpgradeCard />
      <div className="panel home-card">
        <h3 className="home-label">From your officers</h3>
        <GuidesBlock />
      </div>
    </section>
  );
}

/** Whether the reader's machine is on a different clock from the game's at
 * that instant. Somebody whose clock already reads server time is not told
 * the same time twice. */
function hasOwnClock(zone: string, iso: string): boolean {
  return (
    zonedTime(iso, zone) !== zonedTime(iso, SERVER_ZONE) ||
    zonedDayKey(iso, zone) !== zonedDayKey(iso, SERVER_ZONE)
  );
}

function HiveCard({ playerId }: { playerId: string | null }) {
  const plans = useFormations(null);
  const live = (plans.data ?? []).find((p) => p.isActive && p.deletedAt === null) ?? null;
  const board = useBoard(live?.formationId ?? null);
  const [copied, setCopied] = useState(false);
  if (plans.isPending || live === null) {
    return null;
  }
  const mine =
    playerId === null ? undefined : (board.data ?? []).find((s) => s.playerId === playerId);
  const coordinate = mine ? shareCoordinate(live.serverId, { x: mine.x, y: mine.y }) : null;
  return (
    <div className="panel home-card home-hive">
      <p className="home-label">
        Hive move · {live.name} <span className="badge badge-fresh">Plan live</span>
      </p>
      {coordinate ? (
        <p className="home-coordinate">
          <code>{coordinate}</code>
          {mine?.label ? <span className="subtle"> {mine.label}</span> : null}
        </p>
      ) : (
        <p className="empty">You have no tile in this plan.</p>
      )}
      {/* The coordinate says where to teleport; the picture says where that is
          in the shape, which is what somebody checks before they spend the
          item (owner, 2026-11-19). */}
      {mine && <HiveSnapshot board={board.data ?? []} ownPlayerId={playerId} />}
      <p className="subtle">
        Changed {zonedTime(live.editedAt, SERVER_ZONE)} by {live.editedByName ?? 'someone'}
      </p>
      <p className="hive-actions">
        {coordinate && (
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(coordinate);
              setCopied(true);
            }}
            type="button"
          >
            {copied ? 'Copied' : 'Copy coordinates'}
          </button>
        )}
        <a className="filter-chip" href="#/hive">
          See the plan
        </a>
      </p>
    </div>
  );
}

function WeekCard({ playerId }: { playerId: string | null }) {
  const guide = useEventGuide();
  const times = useCapturedTimes();
  const bg = useMyBlackGold(playerId);
  const now = new Date();
  const duel = todaysDuel(guide.data?.themes ?? [], now);
  const team =
    bg.data?.row?.state === 1 || bg.data?.row?.state === 2
      ? (bg.data.row.team_index ?? null)
      : null;
  const next = nextBlackGold(times.data ?? [], team, now);
  // The weekday of the zone's own date: 23:00 server time on Saturday is
  // already Sunday morning in Seoul, and each clock has to name its own day.
  const when = (iso: string, zone: string) => {
    const day = new Date(`${zonedDayKey(iso, zone)}T00:00:00Z`);
    const weekday = WEEKDAYS[(day.getUTCDay() + 6) % 7] ?? '';
    return `${weekday} ${zonedTime(iso, zone)}`;
  };
  const localZone = browserZone();
  return (
    <div className="panel home-card">
      <h3 className="home-label">This week</h3>
      <dl className="home-week">
        <dt>Today</dt>
        <dd>
          {duel ? <strong>Alliance Duel · {duel.name}</strong> : 'No Alliance Duel theme today.'}
        </dd>
        <dt>
          {next ? when(next.startsAt, SERVER_ZONE) : 'Black Gold'}
          {next && <span className="home-week__local">server time</span>}
          {/* The reader's own clock beside the game's (owner, 2026-11-19):
              the game shows server time, the alarm they set does not. */}
          {next && hasOwnClock(localZone, next.startsAt) && (
            <span className="home-week__local">{when(next.startsAt, localZone)} your time</span>
          )}
        </dt>
        <dd>
          <strong>{next ? next.title : 'Black Gold Battlefield'}</strong>
          <br />
          <span className="subtle">
            {playerId === null
              ? 'Link your character to see your team.'
              : bg.isPending
                ? '…'
                : blackGoldLine(bg.data?.row ?? null, bg.data?.readAt ?? null)}
            {bg.data?.objective &&
              ` Your objective: ${bg.data.objective.label}${bg.data.objective.role ? ` — ${bg.data.objective.role}` : ''}.`}
          </span>
        </dd>
      </dl>
      <p>
        <a href="#/event-guide">Event guide</a> · <a href="#/black-gold">Black Gold</a>
      </p>
    </div>
  );
}

function isCalculatorKind(id: string): id is CalculatorKind {
  return (CALCULATOR_KINDS as ReadonlyArray<string>).includes(id);
}

/** "Your next moves" from the mockup. Phase 1 is the calculator inside it
 * (owner: the calculator lives in this card); recommendations for the
 * reader's own account come later (design §4, phase 3). */
function UpgradeCard() {
  return (
    <div className="panel home-card">
      <h3 className="home-label">Upgrades</h3>
      <p className="subtle">What any upgrade costs, from the game's own data.</p>
      <p className="home-kinds">
        {KIND_OPTIONS.flatMap((kind) =>
          // Season buildings are `building` with a filter in the form (url.ts).
          isCalculatorKind(kind.id)
            ? [
                <a
                  className="filter-chip"
                  href={calculatorHash({ ...DEFAULT_STATE, kind: kind.id })}
                  key={kind.id}
                >
                  {kind.label}
                </a>,
              ]
            : [],
        )}
      </p>
      <p>
        <a href="#/calculator">Open the calculator →</a>
      </p>
    </div>
  );
}
