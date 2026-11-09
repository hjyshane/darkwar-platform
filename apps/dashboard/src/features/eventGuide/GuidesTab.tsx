import { useMemo, useState } from 'react';
import { Led, type LedTone } from '../../components/console/Led';
import { Select } from '../../components/ui/Select';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { adminHash, eventGuideHash } from '../../lib/route';
import { humanUntil } from '../../lib/shellNav';
import { browserZone } from '../../lib/timezone';
import { replaceHash } from '../../lib/useHash';
import { useSession } from '../../lib/useSession';
import { serverWhen } from '../calendar/data';
import { GuideSections } from './GuideSections';
import { localHint } from './extras';
import {
  EMPTY_CATALOGUE,
  useBoardPosts,
  useGuideSchedule,
  useGuideSections,
  useGuides,
  useRefCatalogue,
  useScoreItems,
  useViewerAccounts,
} from './guideData';
import {
  type GuideEntry,
  type GuideRow,
  type GuideStart,
  orderGuides,
  parseStartsRule,
  refsIn,
} from './guides';
import { type ScoreItemMap, mergeScoreItems } from './scoreItems';
import { type ParsedSection, parseSections } from './sections/index';
import './guides.css';

// The Guides tab (0310): pick an event, read its guide.
//
// One page for every event. The picker lists what is on, then what is coming;
// the guide below is its sections in order. Nothing here is about a member
// except the prep check, which reads the viewer's OWN stock through the
// planner's account gate.

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** One empty map for "not loaded yet", so the memos below keep their inputs. */
const NO_SCORE_ITEMS: ScoreItemMap = new Map();

function pickerWhen(start: GuideStart, now: Date): string {
  switch (start.state) {
    case 'live':
      return 'live';
    case 'upcoming':
      return start.startsAt === null
        ? ''
        : `in ${humanUntil(Date.parse(start.startsAt) - now.getTime())}`;
    case 'ended':
      return 'ended';
    default:
      return '';
  }
}

export interface GuidePickerProps {
  entries: readonly GuideEntry[];
  /** The slug of the guide shown. */
  selected: string | null;
  onSelect: (slug: string) => void;
  now: Date;
}

/** The guides as filter chips, in the order `orderGuides` gave. */
export function GuidePicker({ entries, selected, onSelect, now }: GuidePickerProps) {
  return (
    <nav aria-label="Event guides" className="eg-picker">
      {entries.map(({ guide, start }) => {
        const when = pickerWhen(start, now);
        return (
          <button
            aria-pressed={guide.slug === selected}
            className="filter-chip"
            key={guide.guide_id}
            onClick={() => onSelect(guide.slug)}
            type="button"
          >
            <span>{guide.title}</span>
            {when !== '' && <span className="eg-picker-when">{when}</span>}
            {!guide.published && <span className="eg-draft">DRAFT</span>}
          </button>
        );
      })}
    </nav>
  );
}

function stateLed(start: GuideStart, now: Date): { tone: LedTone; text: string } {
  switch (start.state) {
    case 'live':
      return { tone: 'ok', text: 'LIVE' };
    case 'upcoming':
      return {
        tone: 'warn',
        text:
          start.startsAt === null
            ? 'UPCOMING'
            : `STARTS IN ${humanUntil(Date.parse(start.startsAt) - now.getTime())}`,
      };
    case 'ended':
      return { tone: 'neutral', text: 'ENDED' };
    default:
      return { tone: 'neutral', text: 'NO START KNOWN' };
  }
}

export interface GuideHeaderProps {
  guide: GuideRow;
  start: GuideStart;
  now: Date;
  /** The viewer's zone, for the bracketed local time. */
  zone: string;
  /** Title of the long-form board post, when the guide links one the viewer
   * may read. */
  postTitle?: string | null;
}

/** What the guide is and when it runs. Times are server time, with the
 * viewer's own in brackets where it differs — the rule the page already uses. */
export function GuideHeader({ guide, start, now, zone, postTitle }: GuideHeaderProps) {
  const led = stateLed(start, now);
  const rule = parseStartsRule(guide.starts_rule);
  const hint = start.startsAt === null ? '' : localHint(start.startsAt, zone);
  return (
    <header className="eg-head">
      <h3>{guide.title}</h3>
      <div className="eg-head-meta">
        <Led tone={led.tone}>{led.text}</Led>
        {!guide.published && <span className="eg-draft">DRAFT</span>}
        {start.startsAt !== null && (
          <span>
            {start.state === 'ended' ? 'Started' : 'Starts'} {serverWhen(start.startsAt, now)}
            {hint === '' ? '' : ` (${hint})`} server time
          </span>
        )}
        {start.source === 'rule' && rule.weekday !== undefined && (
          <span>Every {WEEKDAY[rule.weekday - 1]}, by the officers' rule</span>
        )}
        {rule.servers !== undefined && <span>Servers {rule.servers}</span>}
        {rule.note !== undefined && <span>{rule.note}</span>}
      </div>
      {guide.summary && <p>{guide.summary}</p>}
      {postTitle && (
        <p>
          <a href="#/guides">Long-form guide on the board: {postTitle}</a>
        </p>
      )}
    </header>
  );
}

/** Sections with the score map laid over the client tables, so the catalogue
 * is asked for the mapped items too. */
function withScoreItems(sections: readonly ParsedSection[], map: ScoreItemMap): ParsedSection[] {
  return sections.map((section) =>
    section.kind === 'point_table'
      ? { ...section, payload: mergeScoreItems(section.payload, map) }
      : section,
  );
}

export function GuidesTab({ slug }: { slug: string | null }) {
  const [now] = useState(() => new Date());
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayWrite = isAllowed(permissions?.grants, session?.role, 'guide.write');

  const guides = useGuides();
  const schedule = useGuideSchedule();
  const entries = useMemo(
    () => orderGuides(guides.data ?? [], schedule.data ?? [], now, mayWrite),
    [guides.data, schedule.data, now, mayWrite],
  );
  const chosen = entries.find((entry) => entry.guide.slug === slug) ?? entries[0];

  const sectionRows = useGuideSections(chosen?.guide.guide_id ?? null);
  const scoreItems = useScoreItems();
  const parsed = useMemo(() => parseSections(sectionRows.data ?? []), [sectionRows.data]);
  const map = scoreItems.data ?? NO_SCORE_ITEMS;
  const refs = useMemo(() => refsIn(withScoreItems(parsed, map)), [parsed, map]);
  const catalogue = useRefCatalogue(refs);

  const hasPrep = parsed.some((section) => section.kind === 'prep');
  const accounts = useViewerAccounts(hasPrep);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const listed = accounts.data ?? [];
  const account = listed.find((entry) => entry.playerId === playerId) ?? listed[0];

  const posts = useBoardPosts(chosen?.guide.post_id != null);
  const postTitle =
    posts.data?.find((post) => post.guide_id === chosen?.guide.post_id)?.title ?? null;

  if (guides.isPending) return <p className="empty loading">Loading…</p>;
  if (guides.error) {
    return <p className="error">Could not load the guides: {guides.error.message}</p>;
  }
  if (chosen === undefined) {
    return (
      <p className="empty">
        No guide has been published yet.
        {mayWrite && (
          <>
            {' '}
            <a href={adminHash('catalogue', 'event-guides')}>Write one in Admin.</a>
          </>
        )}
      </p>
    );
  }

  return (
    <div className="eg-guide">
      <GuidePicker
        entries={entries}
        now={now}
        onSelect={(next) => replaceHash(eventGuideHash('guides', next))}
        selected={chosen.guide.slug}
      />
      <GuideHeader
        guide={chosen.guide}
        now={now}
        postTitle={postTitle}
        start={chosen.start}
        zone={browserZone()}
      />
      {hasPrep && listed.length > 1 && (
        <div className="eg-account">
          <label htmlFor="eg-account">Prep check for</label>
          <Select id="eg-account" onChange={setPlayerId} value={account?.playerId ?? ''}>
            {listed.map((entry) => (
              <option key={entry.playerId} value={entry.playerId}>
                {entry.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {sectionRows.isPending && <p className="empty loading">Loading…</p>}
      {sectionRows.error && (
        <p className="error">Could not load the guide: {sectionRows.error.message}</p>
      )}
      {sectionRows.data && (
        <GuideSections
          catalogue={(catalogue.data ?? EMPTY_CATALOGUE).catalogue}
          iconSrc={(catalogue.data ?? EMPTY_CATALOGUE).iconSrc}
          now={now}
          scoreItems={map}
          sections={parsed}
          stock={account ? { items: account.items, resources: account.resources } : null}
          stockReadAt={account?.capturedAt ?? null}
        />
      )}
    </div>
  );
}
