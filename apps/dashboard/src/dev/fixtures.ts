// Fixtures for the local look-around build. Not shipped, not imported by
// anything under src/ except dev/main.tsx.
//
// These go into the QUERY CACHE, not behind an HTTP server. That is the
// whole point: the last Mac mock was a Python PostgREST that had to
// reimplement the protocol, and the one thing it got wrong — a 204 with a
// body, which browsers reject and curl tolerates — made unstarring look
// broken when the app was correct. There is no protocol here to get wrong.
//
// It follows that this build CANNOT verify anything about queries, RLS,
// column grants, or PostgREST behaviour. It shows layout, typography,
// spacing, empty states and navigation. Nothing else.

import { recentWeeks } from '../features/admin/ManualScoresSetting';
import type { AppUser, Waiting } from '../features/admin/MembersSetting';
import type { BoardPage } from '../features/board/board';
import { vacateDeparted } from '../features/hive/hiveFormations';
import { parseAtlas } from '../features/map/atlas';
import { gameDate, seasonPeriod } from '../features/participation/periods';
import { SEASON3_BUILDINGS, levelKey } from '../features/season/buildings';
import { calendarRange } from '../lib/calendar';

const PLAYER = {
  shane: '11111111-1111-4111-8111-111111111101',
  mira: '11111111-1111-4111-8111-111111111102',
  kova: '11111111-1111-4111-8111-111111111103',
  dex: '11111111-1111-4111-8111-111111111104',
};

const ALLIANCE = {
  ours: '22222222-2222-4222-8222-222222222201',
  rival: '22222222-2222-4222-8222-222222222202',
};

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

/** One roster row. Deliberately uneven: nulls are the case the UI is most
 *  likely to get wrong, so a third of these figures are unobserved. */
function member(
  playerId: string,
  name: string,
  power: number | null,
  over: Record<string, unknown> = {},
) {
  return {
    player_id: playerId,
    member_rank: 1,
    current_name: name,
    hq_level: 30,
    power,
    kills: 5_400_000,
    daily_donation_score: 120_000,
    weekly_donation_score: 860_000,
    duel_daily_score: 44_000,
    duel_weekly_score: 310_000,
    duel_round_score: 1_020_000,
    assigned_rank: null,
    computed_rank: 'R2',
    rank_score: 62.5,
    growth_1d: 0.004,
    growth_7d: 0.031,
    growth_1d_at: ago(60 * 26),
    growth_7d_at: ago(60 * 24 * 7),
    online_state: 'offline',
    last_online_at: ago(180),
    last_seen_at: ago(35),
    // 0092/0102: the member_roster view CASE-gates these below officer, so
    // null is also what a member-role reader would see. The overrides below
    // put a live pass, an expired one and never-observed side by side.
    month_card_expires_at: null,
    vip_level: null,
    vip_expires_at: null,
    svip_level: null,
    ...over,
  };
}

const ROSTER = [
  member(PLAYER.shane, 'Shane', 61_200_000, {
    assigned_rank: 'R5',
    computed_rank: 'R1',
    member_rank: 5,
    month_card_expires_at: ahead(18),
    vip_level: 9,
    vip_expires_at: ahead(100),
  }),
  member(PLAYER.mira, 'Mira', 48_900_000, {
    assigned_rank: 'R4',
    online_state: 'online',
    member_rank: 4,
    // Ran out — the column fades it rather than hiding it.
    month_card_expires_at: ago(60 * 24 * 6),
    vip_level: 7,
    vip_expires_at: ahead(40),
    svip_level: 1,
  }),
  // Never observed for contribution: every one of these must render "—",
  // never 0, and must sort last in both directions.
  member(PLAYER.kova, 'Kova', 33_100_000, {
    daily_donation_score: null,
    weekly_donation_score: null,
    duel_daily_score: null,
    duel_weekly_score: null,
    duel_round_score: null,
    growth_1d: null,
    growth_7d: null,
    online_state: null,
    last_online_at: null,
    computed_rank: 'R3',
  }),
  member(PLAYER.dex, 'Dex', null, { kills: null, computed_rank: 'R3', member_rank: null }),
];

const ALLIANCE_ROWS = [
  {
    snapshot_id: 'as-1',
    alliance_id: ALLIANCE.ours,
    external_id: 'ext-ours',
    server_id: 580,
    rank: 1,
    name: 'HELLBOUND',
    code: 'CBFW',
    power: 4_120_000_000,
    member_count: 93,
    captured_at: ago(40),
  },
  {
    snapshot_id: 'as-2',
    alliance_id: ALLIANCE.rival,
    external_id: 'ext-rival',
    server_id: 581,
    rank: 2,
    name: 'Iron Wolves',
    code: 'IRWF',
    power: 3_770_000_000,
    member_count: 88,
    captured_at: ago(40),
  },
  {
    snapshot_id: 'as-3',
    alliance_id: '22222222-2222-4222-8222-222222222203',
    external_id: 'ext-third',
    server_id: 584,
    rank: 3,
    // A rank we have seen but whose member count nobody has read.
    name: 'Nightfall',
    code: null,
    power: 2_140_000_000,
    member_count: null,
    captured_at: ago(60 * 30),
  },
];

const CROSS_ROWS = [
  {
    id: 'x1',
    rank: 1,
    name: 'Shane',
    game_uid: 58001,
    server_id: 580,
    value: 61_200_000,
    unit_id: null,
    captured_at: ago(50),
  },
  {
    id: 'x2',
    rank: 2,
    name: 'Ryn',
    game_uid: 58210,
    server_id: 582,
    value: 59_800_000,
    unit_id: null,
    captured_at: ago(50),
  },
  {
    id: 'x3',
    rank: 3,
    name: 'Mira',
    game_uid: 58002,
    server_id: 580,
    value: 48_900_000,
    unit_id: null,
    captured_at: ago(50),
  },
  {
    id: 'x4',
    rank: 4,
    // Never resolved to a name — the board carries a uid and nothing else.
    name: null,
    game_uid: 58411,
    server_id: 584,
    value: null,
    unit_id: null,
    captured_at: ago(50),
  },
];

const CAPABILITIES = [
  { capability: 'members.view', label: 'See the Members screen', description: '', sort_order: 5 },
  {
    capability: 'data.enter',
    label: 'Enter data by hand',
    description: 'Type in weekly scores and roster changes for weeks the collector could not run.',
    sort_order: 120,
  },
  {
    capability: 'hive.plan',
    label: 'Plan a hive formation',
    description: 'Draw the tiles of a hive or rally formation and assign members to them.',
    sort_order: 110,
  },
  {
    capability: 'members.manage',
    label: 'Manage members',
    description: "Set a member's role and alliance rank, and edit this permission grid.",
    sort_order: 10,
  },
  {
    capability: 'settings.write',
    label: 'Change dashboard settings',
    description: 'The pinned alliance, which figures the overview shows, and the formulas.',
    sort_order: 20,
  },
  {
    capability: 'catalogue.write',
    label: 'Edit the hero and pet catalogues',
    description: 'Names, classes and grades.',
    sort_order: 30,
  },
  { capability: 'arena.view', label: 'See the Arena screen', description: '', sort_order: 35 },
  {
    capability: 'announcement.read',
    label: 'Read member notices',
    description: '',
    sort_order: 40,
  },
  { capability: 'announcement.write', label: 'Post a notice', description: '', sort_order: 50 },
  { capability: 'announcement.edit', label: 'Edit a notice', description: '', sort_order: 60 },
  { capability: 'announcement.delete', label: 'Delete a notice', description: '', sort_order: 70 },
  // 0078. Officers write and edit guides; only an admin deletes one.
  { capability: 'guide.write', label: 'Write a guide', description: '', sort_order: 80 },
  { capability: 'guide.edit', label: 'Edit a guide', description: '', sort_order: 90 },
  { capability: 'guide.delete', label: 'Delete a guide', description: '', sort_order: 100 },
  // 0124. Members read the calendar; officers write it, because a calendar
  // only one person can edit is wrong whenever that person is asleep.
  { capability: 'schedule.view', label: 'See the schedule', description: '', sort_order: 110 },
  {
    capability: 'schedule.manage',
    label: 'Add and change schedule entries',
    description: '',
    sort_order: 120,
  },
  // 0251. Officers and admins by default.
  { capability: 'giftcodes.manage', label: 'Manage gift codes', description: '', sort_order: 140 },
];

const ROLES = ['viewer', 'member', 'officer', 'admin'] as const;

const GRANTS = ROLES.flatMap((role) =>
  CAPABILITIES.map((cap) => ({
    role,
    capability: cap.capability,
    allowed:
      role === 'admin' ||
      (role === 'officer' && cap.capability !== 'members.manage') ||
      (role === 'member' &&
        ['members.view', 'arena.view', 'announcement.read'].includes(cap.capability)),
  })),
);

/** A board page, as `features/board/board.ts` assembles it.
 *
 * Built rather than typed out: twenty-two titles by hand would be twenty-two
 * chances to look at a list that is uniform in a way a real board never is, and
 * the pager only appears once there are more rows than fit on a page.
 */
const AUTHORS = {
  [PLAYER.shane]: 'ShaneOfCBFW',
  [PLAYER.mira]: 'MiraKV',
};

const GUIDE_TITLES = [
  'Reading the rank report',
  'Bear Hunt: when to save your stamina',
  'Which hero goes in slot three',
  'Zombie siege — the two waves that matter',
  'Duel points without spending gems',
  'What counts as contribution',
  'Tower levels are not power',
  'Arena: picking a team you can beat',
  'Alliance donations, and why Monday matters',
  'Radar missions worth the march time',
];

function guidePost(index: number, read: boolean) {
  const id = `33333333-3333-4333-8333-3333333333${String(index).padStart(2, '0')}`;
  return {
    post: {
      id,
      title: `${GUIDE_TITLES[index % GUIDE_TITLES.length]}${index >= GUIDE_TITLES.length ? ` (${Math.floor(index / GUIDE_TITLES.length) + 1})` : ''}`,
      body: `A short body. The list does not show it — **${id.slice(-2)}** is on its own page.`,
      pinned: false,
      liveAt: ago(60 * 24 * (index + 1)),
      createdAt: ago(60 * 24 * (index + 1)),
      // Every fourth one has been edited since, which is the only way to see
      // the Edited column carry a badge rather than a dash.
      updatedAt: index % 4 === 0 ? ago(60 * 3) : ago(60 * 24 * (index + 1)),
      createdBy: index % 3 === 0 ? PLAYER.shane : index % 3 === 1 ? PLAYER.mira : null,
      tag: (['tip', 'strategy', 'info'] as const)[index % 3] ?? null,
    },
    read,
  };
}

function guideBoard(page: number): BoardPage {
  const total = 22;
  const all = Array.from({ length: total }, (_, index) => guidePost(index, index % 3 !== 0));
  const slice = all.slice((page - 1) * 20, (page - 1) * 20 + 20);
  return {
    posts: slice.map((entry) => entry.post),
    pinned: [
      {
        id: '33333333-3333-4333-8333-333333333399',
        title: 'Start here — what this dashboard is',
        body: 'Pinned, so it is on every page.',
        pinned: true,
        liveAt: ago(60 * 24 * 30),
        createdAt: ago(60 * 24 * 30),
        updatedAt: ago(60 * 24 * 30),
        createdBy: PLAYER.shane,
        tag: 'info',
      },
    ],
    total,
    page,
    pageCount: 2,
    authors: AUTHORS,
    read: new Set(all.filter((entry) => entry.read).map((entry) => entry.post.id)),
    // Sparse on purpose, as the real views are: a post nobody has answered or
    // opened has no entry at all. Enough here to put a "top" on the pinned
    // post and a "hot" on one busy thread.
    commentCounts: {
      '33333333-3333-4333-8333-333333333301': 2,
      '33333333-3333-4333-8333-333333333304': 1,
    },
    views: {
      '33333333-3333-4333-8333-333333333399': { total: 41, recent: 3 },
      '33333333-3333-4333-8333-333333333301': { total: 12, recent: 4 },
      '33333333-3333-4333-8333-333333333302': { total: 3, recent: 0 },
    },
  };
}

function noticeBoard(): BoardPage {
  const post = (index: number, title: string, pinned: boolean, visibility: string) => ({
    id: `44444444-4444-4444-8444-4444444444${String(index).padStart(2, '0')}`,
    title,
    body: 'Body lives on the notice page.',
    pinned,
    liveAt: ago(60 * 24 * index),
    createdAt: ago(60 * 24 * index),
    updatedAt: ago(60 * 24 * index),
    createdBy: index % 2 === 0 ? PLAYER.shane : null,
    visibility,
    tag: visibility,
  });
  return {
    posts: [
      post(2, 'Weekly board resets Monday 02:00 UTC', false, 'member'),
      post(5, 'Arena week — sign-ups close Friday', false, 'member'),
      post(9, 'Anyone can read this one', false, 'public'),
    ],
    pinned: [post(1, 'Welcome to CBFW dashboard!!', true, 'member')],
    total: 3,
    page: 1,
    pageCount: 1,
    authors: AUTHORS,
    read: new Set<string>(),
    commentCounts: { '44444444-4444-4444-8444-444444444405': 1 },
    views: {
      '44444444-4444-4444-8444-444444444401': { total: 19, recent: 2 },
      '44444444-4444-4444-8444-444444444402': { total: 7, recent: 7 },
    },
  };
}

/** Every key the app asks for, with the data it expects behind it.
 *
 * A key that is absent is not a mistake — the screen will render its own
 * "nothing here" state, which is worth looking at too. */
export const SESSION_KEY = ['session'] as const;

/** The map (Task 6, season-3-calculator plan). ONE PLAYER, ONE COORDINATE,
 * MATCHING THE DESKTOP APP'S SEEDED JOURNAL FIXTURE EXACTLY — the whole
 * point of this phase is that the two apps agree on where a pin lands, and
 * that can only be checked by pointing both renderers at the same tile:
 * ERHA SANGMAIMA at 310,622 on server 581, uid 1190060554000581 (see
 * services/collector/tests/test_desktop_sidecar.py and
 * docs/runbooks/map-agreement.md).
 *
 * useSightingSearch's query key carries the trimmed search text, so the
 * fixture only answers a search for exactly "erha" — MapPage.tsx's own
 * MIN_QUERY (2 chars) is satisfied by that. useScannedServers needs server
 * 581 to appear as swept or the tab never offers it. */
const MAP_SERVER_ID = 581;
const MAP_SEARCH_TERM = 'erha';

/** Trucks and plunder missions over the map: two trucks on this server (one mid-leg,
 * one only known by where it set off from), one on another server, and two missions. */
function huntTrucksFixture() {
  const minutes = (n: number) => new Date(Date.now() + n * 60_000);
  const truck = (id: string, serverId: number, quality: number, shards: number, rob: number) => ({
    truckUuid: id,
    serverId,
    ownerName: `Hauler ${id}`,
    allianceAbbr: 'EXMP',
    quality,
    heroFragments: shards,
    robTimes: rob,
    arriveAt: minutes(60 + shards * 20),
    leg: null as null | {
      from: { x: number; y: number };
      to: { x: number; y: number };
      startAt: Date;
      endAt: Date;
    },
    route: null,
    origin: null as null | { x: number; y: number },
    positionSeenAt: null,
    cargoSeenAt: minutes(-3),
  });
  const moving = truck('1001', MAP_SERVER_ID, 5, 2, 0);
  moving.leg = {
    from: { x: 300, y: 300 },
    to: { x: 520, y: 480 },
    startAt: minutes(-4),
    endAt: minutes(6),
  };
  const settingOff = truck('1002', MAP_SERVER_ID, 4, 1, 1);
  settingOff.origin = { x: 700, y: 620 };
  const elsewhere = truck('1003', 583, 5, 3, 0);
  elsewhere.origin = { x: 200, y: 700 };
  return [moving, settingOff, elsewhere];
}

function huntMissionsFixture() {
  const minutes = (n: number) => new Date(Date.now() + n * 60_000);
  const mission = (id: string, x: number, y: number, books: number, left: number) => ({
    missionUuid: id,
    serverId: MAP_SERVER_ID,
    at: { x, y },
    ownerName: `Owner ${id}`,
    allianceAbbr: 'EXMP',
    orangeBooks: books,
    stealMax: 3,
    endsAt: minutes(left),
  });
  return [mission('m1', 410, 215, 6, 70), mission('m2', 130, 230, 6, 25)];
}

/** The alliance-coloured map (0260): eight made-up alliances, each a loose clump
 * of bases around its own centre. A seeded generator, so the picture is the same
 * on every reload and a change in how it looks is a change in the code. */
function atlasFixture() {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };
  const centres: Array<[string, string, number, number, number]> = [
    ['CBFW', 'HELLBOUND', 130, 215, 68],
    ['ES_1', 'Guardian Galaxy', 400, 210, 99],
    ['GAR7', 'GARUDAKU', 310, 650, 87],
    ['FUCT', 'future city', 120, 405, 76],
    ['GNSQ', 'Goon Squadz', 280, 395, 63],
    ['LovE', 'Little Ovls & Eagles', 860, 330, 63],
    ['F4T2', 'FATE Academy', 600, 520, 17],
    ['SiNS', 'SiNS', 700, 150, 13],
  ];
  const alliances = centres.map(([code, name, , , bases], i) => ({
    id: `fixture-alliance-${i}`,
    code,
    name,
    bases,
    power: bases * 90_000_000,
  }));
  const bases: Array<Array<number | string | null>> = [];
  let uid = 1_000_000_000_000_581;
  centres.forEach(([code, , cx, cy, count], index) => {
    for (let n = 0; n < count; n += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 32;
      bases.push([
        uid++,
        Math.round(cx + Math.cos(angle) * radius),
        Math.round(cy + Math.sin(angle) * radius * 0.8),
        28 + Math.floor(random() * 8),
        Math.round(20_000_000 + random() * 200_000_000),
        index,
        Math.floor(Date.now() / 1000) - Math.floor(random() * 200_000),
        `${code} ${n + 1}`,
      ]);
    }
  });
  for (let n = 0; n < 220; n += 1) {
    bases.push([
      uid++,
      Math.floor(random() * 1000),
      Math.floor(random() * 1000),
      20 + Math.floor(random() * 10),
      Math.round(random() * 60_000_000),
      -1,
      Math.floor(Date.now() / 1000) - Math.floor(random() * 400_000),
      `wanderer ${n + 1}`,
    ]);
  }
  return parseAtlas({ alliances, bases });
}

/** The week the calendar opens on, and its query key.
 *
 * Derived with the same function the screen uses rather than copied: the key
 * holds the window's ISO bounds, so anything hand-written stops matching the
 * moment the week turns over — and a missed key renders as an empty calendar
 * rather than as an error.
 */
const SCHEDULE_RANGE = calendarRange('week', new Date());
const SCHEDULE_DAYS = SCHEDULE_RANGE.days.map((day) => day.toISOString().slice(0, 10));
// The hook widens the window by a day at each end, because the grid's cells are
// days in the READER'S zone while this range is in UTC. The key has to be built
// the same way or the fixture matches nothing and the screen draws an empty
// calendar — which looks exactly like a week with nothing on it.
const SCHEDULE_DAY_MS = 86_400_000;
const SCHEDULE_KEY = [
  'schedule',
  'events',
  new Date(SCHEDULE_RANGE.start.getTime() - SCHEDULE_DAY_MS).toISOString(),
  new Date(SCHEDULE_RANGE.end.getTime() + SCHEDULE_DAY_MS).toISOString(),
];

/** Held as a stable reference so main.tsx can tell "still the fixture" from
 *  "something replaced it" by identity. */
/** One formation and the tiles under it, for the look-around build.
 *
 * Offsets rather than coordinates, the way 0165 stores them: the board
 * fixture has to carry x and y as well because the VIEW computes those, and
 * a fixture that computed them differently would hide exactly the bug that
 * matters. `anchor + offset` is done here by hand, once, so the two agree.
 */
export const HIVE_FORMATION_ID = '11111111-1111-4111-8111-1111111111f1';

const MIGRATION_ID = '11111111-1111-4111-8111-1111111111e1';

function migrationServer(serverId: number, counts: Record<string, number>) {
  return {
    server_id: serverId,
    tracked_before: 0,
    tracked_after: 0,
    stayed: 0,
    moved_out: 0,
    moved_in: 0,
    unseen_after: 0,
    appeared: 0,
    power_out: 0,
    power_in: 0,
    top_before: 0,
    top_after: 0,
    top_power_before: 0,
    top_power_after: 0,
    ...counts,
  };
}

function migrationPerson(
  n: number,
  name: string,
  status: string,
  [before, after]: [number | null, number | null],
  [powerBefore, powerAfter]: [number | null, number | null],
  [rankBefore, rankAfter]: [number | null, number | null],
) {
  return {
    game_uid: 9_000_000_000_000_000 + n * 1_000_000 + (before ?? after ?? 580),
    player_id: Object.values(PLAYER)[n - 1],
    name,
    home_server_id: before ?? after ?? 580,
    status,
    before_server_id: before,
    before_power: powerBefore,
    before_alliance: before === null ? null : 'OUR',
    before_rank: rankBefore,
    before_at: before === null ? null : ago(4400),
    after_server_id: after,
    after_power: powerAfter,
    after_alliance: after === null ? null : 'OUR',
    after_rank: rankAfter,
    after_at: after === null ? null : ago(60),
  };
}

const HIVE_ANCHOR = { x: 512, y: 388 };

const HIVE_FORMATIONS = [
  {
    formationId: HIVE_FORMATION_ID,
    name: 'Hive move 09-12',
    serverId: 580,
    anchorX: HIVE_ANCHOR.x,
    anchorY: HIVE_ANCHOR.y,
    note: '',
    isActive: true,
    updatedAt: ago(90),
  },
  {
    formationId: '11111111-1111-4111-8111-1111111111f2',
    name: 'Bear rally (draft)',
    serverId: 580,
    anchorX: 500,
    anchorY: 500,
    note: '',
    isActive: false,
    updatedAt: ago(60 * 30),
  },
];

const HIVE_MEMBERS = [
  { playerId: PLAYER.shane, name: 'Shane', power: 61_200_000, hqLevel: 30, memberRank: 5 },
  { playerId: PLAYER.mira, name: 'Mira', power: 48_000_000, hqLevel: 29, memberRank: 4 },
  // Not Kova: the board below has them off the roster, and `member_roster`
  // is the roster, so a member who left is not somebody Fill can hand a tile.
  // No power read yet, which is the case the ordering is most likely to get
  // wrong — it must sort LAST rather than first.
  { playerId: PLAYER.dex, name: 'Dex', power: null, hqLevel: null, memberRank: 1 },
];

// A ring around Frankie rather than a block: the centre four-by-three is its
// ground and nothing may stand on it, so the old fixture's middle tile is
// gone and the east column has moved out to clear the wider footprint.
const HIVE_SLOTS = [
  // Frankie first: a 4x3 structure on the anchor. Since 0169 it is an
  // ordinary tile with a size, which is why it sits in the same list.
  { dx: 0, dy: 0, spanX: 4, spanY: 3, kind: 'structure' as const, colour: 'amber' as const },
  // COLOURED, AND IT IS THE READER'S OWN. An officer can paint a member's base
  // now, and no fixture tile had been, which is why nobody saw that the colour
  // rules were overwriting the own-tile marker: on this square the ring and
  // the paint have to be legible at the same time.
  { dx: -3, dy: 3, colour: 'violet' as const },
  { dx: 0, dy: 3 },
  { dx: 4, dy: 3 },
  { dx: -3, dy: 0 },
  { dx: 4, dy: 0 },
  { dx: -3, dy: -3 },
  { dx: 0, dy: -3 },
  // A 1x1 marker, to see the smallest tile beside the biggest.
  { dx: 4, dy: -3, spanX: 1, spanY: 1, kind: 'structure' as const, colour: 'red' as const },
]
  .map((offset, index) => ({
    slotId: `slot-${index + 1}`,
    ordinal: index + 1,
    label: offset.kind === 'structure' ? (offset.spanX === 1 ? 'keep clear' : 'Frankie') : '',
    dx: offset.dx,
    dy: offset.dy,
    spanX: offset.spanX ?? 3,
    spanY: offset.spanY ?? 3,
    kind: offset.kind ?? ('base' as const),
    colour: offset.colour ?? null,
    x: HIVE_ANCHOR.x + offset.dx,
    y: HIVE_ANCHOR.y + offset.dy,
    playerId:
      offset.kind === 'structure'
        ? null
        : ([PLAYER.shane, PLAYER.mira, PLAYER.kova, PLAYER.dex][index - 1] ?? null),
    playerName:
      offset.kind === 'structure' ? null : (['Shane', 'Mira', 'Kova', 'Dex'][index - 1] ?? null),
    hqLevel: 30,
    power: 61_200_000,
    pinned: false,
    stillAMember: index === 3 ? false : index >= 1 && index <= 4 ? true : null,
    assignedAt: index >= 1 && index <= 4 ? ago(90) : null,
    departedName: null,
    // Through the same step the real read takes, so Kova (who has left) shows
    // here the way a departed member shows on the live board: as an empty tile.
  }))
  .map(vacateDeparted);

/** The participation report (0204), for the season so far — the range the
 *  page opens on, computed by the same function so the key matches.
 *
 *  Four members, four different shapes: Shane takes part in everything, Mira
 *  is under half on duel days and missed Black Gold, Kova has never been read
 *  on any board (every captured cell must be a dash, not 0), and Dex was never
 *  listed for Black Gold. Typed events are uneven too: Frankie has a member
 *  nobody ticked, and Ice Pit and Furnace Fury were never held. */
const PARTICIPATION_RANGE = seasonPeriod(new Date());

function participation(
  playerId: string,
  name: string,
  memberRank: number | null,
  over: Record<string, unknown> = {},
) {
  return {
    player_id: playerId,
    current_name: name,
    game_uid: 9100000000000580,
    member_rank: memberRank,
    duel_days_read: 38,
    duel_days_on_board: 37,
    duel_days_scored: 35,
    duel_weeks_read: 6,
    duel_weeks_on_board: 6,
    duel_weeks_scored: 6,
    duel_total: 8_420_000,
    donation_days_read: 41,
    donation_days_on_board: 41,
    donation_days_scored: 40,
    donation_weeks_read: 7,
    donation_weeks_on_board: 7,
    donation_weeks_scored: 7,
    donation_total: 5_960_000,
    black_gold_listed: 4,
    black_gold_played: 4,
    black_gold_starter_missed: 0,
    black_gold_substitute_missed: 0,
    season_levels_gained: 6,
    watchtower_level: 34,
    watchtower_gained: 2,
    typed_events: {
      capital_clash: { held: 2, attended: 2, missed: 0 },
      server_clash: { held: 1, attended: 1, missed: 0 },
      frankie: { held: 3, attended: 3, missed: 0 },
    },
    ...over,
  };
}

const PARTICIPATION_ROWS = [
  participation(PLAYER.shane, 'Shane', 5),
  participation(PLAYER.mira, 'Mira', 4, {
    duel_days_on_board: 30,
    duel_days_scored: 14,
    duel_total: 2_310_000,
    duel_weeks_scored: 5,
    donation_days_scored: 33,
    black_gold_listed: 4,
    black_gold_played: 2,
    black_gold_starter_missed: 1,
    black_gold_substitute_missed: 1,
    season_levels_gained: 0,
    watchtower_level: 31,
    watchtower_gained: 0,
    typed_events: {
      capital_clash: { held: 2, attended: 1, missed: 1 },
      server_clash: { held: 1, attended: 0, missed: 1 },
      frankie: { held: 3, attended: 1, missed: 0 },
    },
  }),
  participation(PLAYER.kova, 'Kova', 1, {
    duel_days_on_board: 0,
    duel_days_scored: 0,
    duel_weeks_on_board: 0,
    duel_weeks_scored: 0,
    duel_total: null,
    donation_days_on_board: 0,
    donation_days_scored: 0,
    donation_weeks_on_board: 0,
    donation_weeks_scored: 0,
    donation_total: null,
    black_gold_listed: 0,
    black_gold_played: 0,
    season_levels_gained: null,
    watchtower_level: 29,
    watchtower_gained: null,
    typed_events: {
      capital_clash: { held: 2, attended: 0, missed: 2 },
      server_clash: { held: 1, attended: 0, missed: 0 },
      frankie: { held: 3, attended: 0, missed: 3 },
    },
  }),
  participation(PLAYER.dex, 'Dex', null, {
    duel_days_scored: 29,
    black_gold_listed: 0,
    black_gold_played: 0,
    season_levels_gained: 2,
    watchtower_level: 27,
    watchtower_gained: 1,
  }),
];

const ATTENDANCE_KINDS = [
  {
    kind: 'capital_clash',
    label: 'Capital Clash',
    sort_order: 10,
    captured: false,
    board: 'event',
  },
  { kind: 'server_clash', label: 'Server Clash', sort_order: 20, captured: false, board: 'event' },
  { kind: 'frankie', label: 'Bio-Mutant', sort_order: 30, captured: false, board: 'event' },
  { kind: 'ice_pit', label: 'Ice Pit', sort_order: 40, captured: false, board: 'season' },
  { kind: 'furnace_fury', label: 'Furnace Fury', sort_order: 50, captured: true, board: 'season' },
];

export const SESSION = {
  email: 'you@example.invalid',
  role: 'admin',
  userId: '33333333-3333-4333-8333-333333333301',
  // The linked character. Without it the hive board cannot say which tile is
  // yours, which is the one line that screen exists to print — an unlinked
  // account is a real state and worth seeing too, but not the default one.
  playerId: PLAYER.shane,
};

/** The game calendar (0208): what one login saw. Real ids from the 10-02
 *  capture, two named by an officer and the rest still bare, which is what
 *  the page looks like on its first day. */
const CALENDAR_SEEN = ago(25);
function calendarEvent(
  id: string,
  startsDays: number | null,
  endsDays: number | null,
  name: string | null = null,
  hq = 10,
) {
  return {
    server_id: 580,
    activity_id: id,
    name,
    category: null,
    activity_type: null,
    starts_at: startsDays === null ? null : ahead(startsDays),
    ends_at: endsDays === null ? null : ahead(endsDays),
    need_hq_level: hq,
    sub_type: null,
    seen_at: CALENDAR_SEEN,
  };
}
/** Category and activity type by id, as `game-names` writes them (0211).
 *  104000 is the Season Celebration: Ice Pit is cut off at its start. */
const CALENDAR_KINDS: Record<string, [string, number]> = {
  '41101': ['season', 126],
  '700001': ['season', 225],
  '55001': ['recurring', 111],
  '111001': ['major', 54],
  '80002': ['major', 71],
  '104000': ['season', 131],
  '492000': ['season', 1008],
  '8072': ['premium', 27],
  '300004': ['premium', 274],
  '40739': ['premium', 20],
  '40086': ['pass', 27],
};
const CALENDAR_ROWS_RAW = [
  calendarEvent('41101', -47, 17, 'Ice Pit'),
  calendarEvent('700001', -47, 9, 'Season 3'),
  calendarEvent('40741', -47, 2),
  calendarEvent('55001', -5, 0.9),
  calendarEvent('400047', -12, 1.9, null, 7),
  calendarEvent('111001', 0.5, 2),
  calendarEvent('80002', 2, 9),
  calendarEvent('104000', 9, 30),
  calendarEvent('97001', 13, 20, null, 8),
  calendarEvent('492000', -5, -0.1),
  calendarEvent('40086', -182, 6400, null, 11),
  calendarEvent('8072', -556, 6400, null, 8),
  calendarEvent('300004', -1.5, 1.2, 'Mod Vehicle Combo Pack', 8),
  calendarEvent('40739', -47, 9, "Bob's Supply Shack"),
  calendarEvent('30000', null, null, null, 6),
];
const CALENDAR_ROWS = CALENDAR_ROWS_RAW.map((row) => ({
  ...row,
  category: CALENDAR_KINDS[row.activity_id]?.[0] ?? 'event',
  activity_type: CALENDAR_KINDS[row.activity_id]?.[1] ?? null,
}));

/** The pack report (0215): three packs and two Ruby-shop entries. */
const SHOP_PACKS = [
  {
    server_id: 580,
    pack_id: '240806011',
    name_key: '240806011',
    name: 'Power Core Pack',
    game_name: 'Power Core Pack',
    renamed: false,
    name_ko: '파워 코어 팩',
    dollars: 4.99,
    rubies: 500,
    claimed_percent: 1200,
    starts_at: ago(24 * 60),
    ends_at: null,
    captured_at: ago(30),
    item_rubies: 5150,
    unvalued_items: 0,
    value_dollars: 55.94,
    value_ratio: 11.21,
    contents_listed: true,
    contents: [
      {
        id: '230110',
        qty: 10,
        name: 'Power Core',
        name_ko: '파워 코어',
        rubies: 461,
        source: 'estimated',
      },
      { id: '210892', qty: 100, name: 'Speedup 5m', name_ko: null, rubies: 5, source: 'game' },
      { id: '222003', qty: 5, name: 'VIP Points', name_ko: null, rubies: 0, source: 'game' },
    ],
  },
  {
    server_id: 580,
    pack_id: '300001',
    name_key: '300001',
    name: 'Doomsday Key Pack',
    game_name: 'Hero Growth Pack',
    renamed: true,
    name_ko: null,
    dollars: 19.99,
    rubies: 2000,
    claimed_percent: 860,
    starts_at: ago(24 * 60),
    ends_at: null,
    captured_at: ago(30),
    item_rubies: 6000,
    unvalued_items: 1,
    value_dollars: 79.2,
    value_ratio: 3.96,
    contents_listed: true,
    contents: [
      {
        id: '230100',
        qty: 10,
        name: 'Prime Recruitment Ticket',
        name_ko: null,
        rubies: 400,
        source: 'game',
      },
      {
        id: '230101',
        qty: 100,
        name: 'Orange Skill Book',
        name_ko: null,
        rubies: 20,
        source: 'officer',
      },
      {
        id: '241748',
        qty: 1,
        name: 'Amethyst Oath Chest',
        name_ko: null,
        rubies: null,
        source: null,
      },
    ],
  },
  {
    server_id: 580,
    pack_id: '9001',
    name_key: '9001',
    name: 'Ruby Pack',
    game_name: 'Ruby Pack',
    renamed: false,
    name_ko: null,
    dollars: 0.99,
    rubies: 100,
    claimed_percent: 100,
    starts_at: null,
    ends_at: null,
    captured_at: ago(30),
    item_rubies: 0,
    unvalued_items: 0,
    value_dollars: 0.99,
    value_ratio: 1,
    contents_listed: true,
    contents: [],
  },
  // A battle pass: listed under one id per tier, contents not in the pack list.
  ...['300000000', '300000001', '300000002'].map((id) => ({
    server_id: 580,
    pack_id: id,
    name: 'Legend Battle Pass',
    name_ko: null,
    dollars: 19.99,
    rubies: 0,
    claimed_percent: 5400,
    starts_at: null,
    ends_at: null,
    captured_at: ago(30),
    item_rubies: 0,
    unvalued_items: 0,
    value_dollars: null,
    value_ratio: null,
    contents: [],
    contents_listed: false,
  })),
];
const SHOP_LISTINGS = [
  {
    server_id: 580,
    shop_type: 2,
    listing_id: 'l1',
    item_id: '230100',
    name: 'Prime Recruitment Ticket',
    name_ko: null,
    qty: 1,
    price: 240,
    discount: 40,
    captured_at: ago(30),
    unit_rubies: 400,
    value_source: 'game',
    value_ratio: 1.67,
  },
  {
    server_id: 580,
    shop_type: 1,
    listing_id: 'l2',
    item_id: '200002',
    name: 'Advanced Teleporter',
    name_ko: null,
    qty: 1,
    price: 1500,
    discount: 0,
    captured_at: ago(30),
    unit_rubies: 1500,
    value_source: 'game',
    value_ratio: 1,
  },
];

/** The material planner (item 4): one account, and the plan for Watchtower
 *  55 -> 56, which needs Alliance Hall 55 (already met) and Fighter Camp 56
 *  (pulled in as a prerequisite). */
const PLANNER_ID = '11111111-1111-4111-8111-111111111101';
const PLANNER_ACCOUNT = {
  playerId: PLANNER_ID,
  name: 'WonderingDuck',
  serverId: 580,
  source: 'login',
  capturedAt: '2026-10-04T01:13:20Z',
  buildings: { '400000': 55, '402000': 55, '424000': 55 },
  science: { '1601100': 12 },
  heroLevels: { '40002': 108, '1017': 97 },
  heroTrained: ['1017'],
  heroSquads: [
    { index: 1, heroes: ['40002'] },
    { index: 2, heroes: [] },
  ],
  vehicle: { level: 279, exp: 1200, suit_level: 27 },
  vehicleParts: { '1': 35, '2': 34 },
  pets: [
    { petId: 106, level: 83, breakthrough: 80, training: { '1': 161, '2': 150 } },
    { petId: 101, level: 60, breakthrough: 60, training: {} },
  ],
  heroGear: [
    { equipId: 410100, heroId: 40002, level: 100, promote: 24 },
    { equipId: 410200, heroId: 40002, level: 88, promote: 0 },
    { equipId: 410100, heroId: 1017, level: 60, promote: 0 },
  ],
  heroExclusives: { '40002': 42 },
  items: { '253042': 2586 },
  resources: {
    '25': 7162671974,
    '12': 7213108138,
    '26': 7099720892,
    '24': 144921608,
    '14': 6276060532,
  },
  effects: { '30070': 156.16, '30071': 171.51, '30421': 20 },
  timedEffects: [],
};
const plannerStep = (
  subject: string,
  level: number,
  name: string,
  parts: number,
  requires: unknown[],
) => ({
  kind: 'building',
  subject_id: subject,
  level,
  name,
  costs: [
    { type: 'resource', id: '25', amount: 150000000 },
    { type: 'resource', id: '12', amount: 150000000 },
    { type: 'resource', id: '26', amount: 150000000 },
    { type: 'item', id: '253042', amount: parts },
  ],
  seconds: 2000000,
  requires,
  tier: subject === '400000' ? 5 : null,
});
const PLANNER_BOOK = new Map([
  [
    'building:400000',
    new Map([
      [
        56,
        plannerStep('400000', 56, 'Watchtower', 320, [
          { subject: '402000', level: 55 },
          { subject: '424000', level: 56 },
        ]),
      ],
    ]),
  ],
  ['building:424000', new Map([[56, plannerStep('424000', 56, 'Fighter Camp', 140, [])]])],
]);

/** Placeholder art: a coloured disc. The real icons are the game's and are
 * never committed; this only shows where they sit. */
const PLACEHOLDER_ICON = (colour: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="${colour}"/></svg>`,
  )}`;

// Gift codes (0251): invented codes and names, shaped like gift_code_progress and
// gift_member_status. Four members, one of them left out, three codes.
const GIFT_CODE_IDS = ['gc-1', 'gc-2', 'gc-3'] as const;

export const FIXTURES: [readonly unknown[], unknown][] = [
  [
    ['gift', 'codes'],
    [
      {
        code_id: GIFT_CODE_IDS[0],
        code: 'SAMPLE1',
        status: 'working',
        source: 'officer',
        first_seen_at: '2026-10-08T02:00:00Z',
        checked_at: '2026-10-08T03:00:00Z',
        members: 3,
        queued: 1,
        running: 0,
        done: 1,
        already: 1,
        failed: 0,
        other: 0,
      },
      {
        code_id: GIFT_CODE_IDS[1],
        code: 'SAMPLE2',
        status: 'unverified',
        source: 'officer',
        first_seen_at: '2026-10-09T01:00:00Z',
        checked_at: null,
        members: 3,
        queued: 0,
        running: 0,
        done: 0,
        already: 0,
        failed: 0,
        other: 0,
      },
      {
        code_id: GIFT_CODE_IDS[2],
        code: 'OLDONE3',
        status: 'expired',
        source: 'officer',
        first_seen_at: '2026-09-20T01:00:00Z',
        checked_at: '2026-09-25T01:00:00Z',
        members: 3,
        queued: 0,
        running: 0,
        done: 2,
        already: 0,
        failed: 1,
        other: 0,
      },
    ],
  ],
  [
    ['gift', 'runner'],
    { enabled: false, paused_until: null, halted_reason: null, last_sent_at: null },
  ],
  [
    ['gift', 'members'],
    [
      {
        game_uid: 1000000000000001,
        name: 'Alpha',
        rank: 5,
        excluded: false,
        claims: { 'gc-1': 'done', 'gc-3': 'done' },
      },
      {
        game_uid: 1000000000000002,
        name: 'Bravo',
        rank: 4,
        excluded: false,
        claims: { 'gc-1': 'already', 'gc-3': 'failed' },
      },
      {
        game_uid: 1000000000000003,
        name: 'Charlie',
        rank: 4,
        excluded: false,
        claims: { 'gc-1': 'queued', 'gc-3': 'done' },
      },
      {
        game_uid: 1000000000000004,
        name: 'Delta (left out)',
        rank: 3,
        excluded: true,
        claims: {},
      },
    ],
  ],
  [
    ['game-icons', 'hero'],
    new Map([
      ['40002', PLACEHOLDER_ICON('#f59e0b')],
      ['1017', PLACEHOLDER_ICON('#a855f7')],
    ]),
  ],
  [['game-icons', 'gear'], new Map([['410100', PLACEHOLDER_ICON('#64748b')]])],
  [['game-icons', 'exclusive'], new Map([['40002', PLACEHOLDER_ICON('#ef4444')]])],
  [
    ['game-icons', 'item', '230104,253042,253070'],
    new Map([
      ['253042', PLACEHOLDER_ICON('#22c55e')],
      ['230104', PLACEHOLDER_ICON('#38bdf8')],
    ]),
  ],
  [
    ['game-icons', 'resource'],
    new Map([
      ['25', PLACEHOLDER_ICON('#a16207')],
      ['12', PLACEHOLDER_ICON('#94a3b8')],
    ]),
  ],
  [['planner-accounts'], [PLANNER_ACCOUNT]],
  [
    ['planner-materials'],
    [
      { type: 'resource', id: '25', kinds: ['building'] },
      { type: 'resource', id: '12', kinds: ['building', 'research'] },
      { type: 'resource', id: '26', kinds: ['building'] },
      { type: 'resource', id: '24', kinds: ['hero'] },
      { type: 'resource', id: '14', kinds: ['research'] },
      { type: 'item', id: '253042', kinds: ['building'] },
      { type: 'item', id: '230104', kinds: ['hero_gear'] },
      { type: 'item', id: '253070', kinds: ['exclusive'] },
    ],
  ],
  [
    ['planner-names', '253042,230104,253070'],
    {
      items: new Map([
        ['253042', 'Precision Part'],
        ['230104', 'Boost Ore'],
        ['253070', 'Pyro Pup Fragments'],
      ]),
      resources: new Map([
        ['25', 'Wood'],
        ['12', 'Iron'],
        ['26', 'Electricity'],
        ['24', 'Food'],
        ['14', 'Coin'],
      ]),
    },
  ],
  [
    ['planner-enterable'],
    [{ playerId: '11111111-1111-4111-8111-111111111102', name: 'Player02', serverId: 580 }],
  ],
  [
    ['planner-catalog', 'building', '*'],
    [
      { subject: '400000', name: 'Watchtower', maxLevel: 80, category: null },
      { subject: '402000', name: 'Alliance Hall', maxLevel: 80, category: null },
      { subject: '403000', name: 'Research Center', maxLevel: 80, category: null },
      { subject: '424000', name: 'Fighter Camp', maxLevel: 80, category: null },
    ],
  ],
  [
    ['planner-heroes', '11111111-1111-4111-8111-111111111102', true],
    {
      names: new Map([
        ['40002', 'Pyro Pup'],
        ['1017', 'Mia'],
        ['1002', 'Kane'],
      ]),
      gear: new Map([
        [410100, { name: 'D5-Slayer', quality: 5, slot: 1 }],
        [410200, { name: 'D5-Armor', quality: 5, slot: 2 }],
      ]),
      exclusives: new Map([['40002', 52]]),
      grade: new Map([
        ['40002', 3],
        ['1017', 2],
        ['1002', 1],
      ]),
      troopClass: new Map([
        ['40002', 2],
        ['1017', 1],
      ]),
    },
  ],
  [
    ['planner-tiers'],
    new Map([
      [
        '400000',
        new Map([
          [55, 5],
          [56, 5],
          [60, 6],
          [80, 10],
        ]),
      ],
    ]),
  ],
  [
    ['planner-catalog', 'building', '400000,402000,424000'],
    [
      { subject: '400000', name: 'Watchtower', maxLevel: 80, category: null },
      { subject: '402000', name: 'Alliance Hall', maxLevel: 80, category: null },
      { subject: '424000', name: 'Fighter Camp', maxLevel: 80, category: null },
    ],
  ],
  [
    ['planner-research-tabs', 580],
    [
      { tabId: 1003, name: 'New Home' },
      { tabId: 1007, name: 'Battle' },
      { tabId: 23, name: 'Battle Strategy' },
    ],
  ],
  [
    ['planner-catalog', 'research', 1003],
    [
      { subject: '1601100', name: 'Field Formation', maxLevel: 20, category: 1003 },
      { subject: '1601200', name: 'Assault Drill', maxLevel: 10, category: 1003 },
    ],
  ],
  [
    ['planner-heroes', PLANNER_ID, false],
    {
      names: new Map([
        ['40002', 'Pyro Pup'],
        ['1017', 'Mia'],
      ]),
      gear: new Map([
        [410100, { name: 'D5-Slayer', quality: 5, slot: 1 }],
        [410200, { name: 'D5-Armor', quality: 5, slot: 2 }],
      ]),
      exclusives: new Map([['40002', 52]]),
      grade: new Map([
        ['40002', 3],
        ['1017', 2],
        ['1002', 1],
      ]),
      troopClass: new Map([
        ['40002', 2],
        ['1017', 1],
      ]),
    },
  ],
  [
    ['planner-catalog', 'hero-maxima'],
    new Map([
      ['hero', 200],
      ['level:q5', 100],
      ['promote', 36],
    ]),
  ],
  [
    [
      'planner-book',
      PLANNER_ID,
      JSON.stringify([{ kind: 'building', subject: '400000', from: 55, to: 56 }]),
      true,
    ],
    PLANNER_BOOK,
  ],
  [
    ['planner-names', '253042'],
    {
      items: new Map([['253042', 'Precision Part']]),
      resources: new Map([
        ['25', 'Wood'],
        ['12', 'Iron'],
        ['26', 'Electricity'],
      ]),
    },
  ],
  [['shop-packs'], SHOP_PACKS],
  [['shop-listings'], SHOP_LISTINGS],
  [
    ['shop-values'],
    [
      {
        item_id: '230110',
        rubies: 461,
        source: 'estimated',
        note: null,
        updated_at: ago(60),
        name: 'Power Core',
        game_name: 'Power Core',
        renamed: false,
        name_ko: '파워 코어',
      },
      {
        item_id: '230100',
        rubies: 400,
        source: 'game',
        note: null,
        updated_at: ago(60),
        name: 'Prime Recruitment Ticket',
        game_name: 'Prime Recruitment Ticket',
        renamed: false,
        name_ko: null,
      },
      {
        item_id: '210892',
        rubies: 5,
        source: 'officer',
        note: 'checked in game',
        updated_at: ago(5),
        name: '5-min Speedup',
        game_name: null,
        renamed: true,
        name_ko: null,
      },
    ],
  ],
  [['event-calendar'], CALENDAR_ROWS],
  [SESSION_KEY, SESSION],
  [['permissions'], { capabilities: CAPABILITIES, grants: GRANTS }],
  // The score bars (0239) are part of the report's key; none set is the report as it was.
  [['participation-bars'], { duel: null, donation: null }],
  // The season boards: a building grid, and the two rankings (newest capture each).
  [
    ['seasonBoard', 'buildings', 3, SEASON3_BUILDINGS.map((kind) => kind.id).join(',')],
    {
      members: [
        ['Mira', 31],
        ['Kova', 28],
        ['Dex', 22],
        ['Shane', 35],
        ['Ren', 12],
      ].map(([name, base], index) => ({
        playerId: `season-${index}`,
        name: name as string,
        gameUid: 9100 + index,
        oldestSeen: ago(90),
        levelSince: {},
        seenAt: Object.fromEntries(SEASON3_BUILDINGS.map((kind) => [kind.id, ago(90)])),
        ...Object.fromEntries(
          SEASON3_BUILDINGS.map((kind) => [levelKey(kind.id), (base as number) - (kind.id % 5)]),
        ),
      })),
      columns: SEASON3_BUILDINGS,
      capturedAt: ago(20),
      unnamedSeen: 3,
      rosterTotal: 71,
    },
  ],
  [
    ['seasonBoard', 'alliance_score'],
    [
      ['HELLBOUND', 'CBFW', 1_480_000],
      ['GARUDAKU', 'GAR7', 1_390_000],
      ['Little Ovls', 'LovE', 1_020_000],
    ].map(([name, abbr, score], index) => ({
      id: `as-${index}`,
      allianceId: null,
      externalId: `ext-${index}`,
      rank: index + 1,
      previousRank: index + 1,
      name,
      abbr,
      server_id: 580,
      score,
      power: null,
      captured_at: ago(60),
    })),
  ],
  [
    ['seasonBoard', 'player_force'],
    [
      ['Mira', 8200],
      ['Kova', 7400],
      ['Dex', 6100],
    ].map(([name, force], index) => ({
      id: `pf-${index}`,
      playerId: null,
      rank: index + 1,
      name,
      game_uid: 9100 + index,
      server_id: 580,
      allianceName: 'HELLBOUND',
      abbr: 'CBFW',
      force,
      captured_at: ago(60),
    })),
  ],
  // The event guide (0248): trimmed from what the game sent on 2026-10-08.
  [
    ['event-guide'],
    {
      themes: [
        {
          activity_id: '100004',
          event_id: '10000401',
          day: null,
          name: 'Shelter Expansion',
          name_ko: null,
          min_day_score: null,
          min_week_score: null,
        },
        {
          activity_id: '100004',
          event_id: '10000402',
          day: null,
          name: 'Hero Initiative',
          name_ko: null,
          min_day_score: null,
          min_week_score: null,
        },
        {
          activity_id: '70005',
          event_id: '110030',
          day: 1,
          name: 'Shelter Expansion',
          name_ko: null,
          min_day_score: 10000,
          min_week_score: 100000,
        },
        {
          activity_id: '70005',
          event_id: '110033',
          day: 4,
          name: 'Arms Expert',
          name_ko: null,
          min_day_score: 10000,
          min_week_score: 100000,
        },
      ],
      scores: [
        {
          activity_id: '100004',
          event_id: '10000401',
          score_id: 'a',
          action: 'Use {0} Precision Parts in building upgrades',
          per_value: 1,
          points: 300,
          sort_order: 0,
        },
        {
          activity_id: '100004',
          event_id: '10000401',
          score_id: 'b',
          action: 'Increase Structure CP by {0} Points',
          per_value: 100,
          points: 10,
          sort_order: 1,
        },
        {
          activity_id: '100004',
          event_id: '10000402',
          score_id: 'c',
          action: 'Perform {0} Prime Recruits',
          per_value: 1,
          points: 400,
          sort_order: 0,
        },
        {
          activity_id: '70005',
          event_id: '110030',
          score_id: 'd',
          action: 'Buy Packs to Get {0} Rubies',
          per_value: 1,
          points: 10,
          sort_order: 0,
        },
        {
          activity_id: '70005',
          event_id: '110033',
          score_id: 'e',
          action: 'Open 1 Orange-quality Chip Chest',
          per_value: 1,
          points: 40000,
          sort_order: 0,
        },
      ],
      calendar: [1, 2, 3, 4, 5, 6, 7].flatMap((day) =>
        [1, 2, 3, 4, 5, 6].map((slot) => ({
          activity_id: '100004',
          day,
          slot,
          event_id: (day + slot) % 2 === 0 ? '10000401' : '10000402',
        })),
      ),
    },
  ],
  [
    ['event-guide', 'duel-board'],
    {
      members: ROSTER.map((row) => ({ player_id: row.player_id, current_name: row.current_name })),
      readings: ROSTER.map((row, index) => ({
        player_id: row.player_id,
        duel_daily_score: index === 1 ? null : 44_000 - index * 6_000,
        duel_daily_updated_at: index === 2 ? ago(60 * 30) : ago(40),
        duel_weekly_score: 310_000 - index * 40_000,
        duel_weekly_updated_at: ago(40),
      })),
    },
  ],
  [
    ['event-guide', 'captured-times'],
    [
      { id: 't1', title: 'Zombie Siege', startsAt: '2026-10-08T13:30:00Z', endsAt: null },
      {
        id: 't2',
        title: 'Frankie 1',
        startsAt: '2026-10-08T02:30:00Z',
        endsAt: '2026-10-08T03:02:00Z',
      },
      {
        id: 't3',
        title: 'Black Gold, team B',
        startsAt: '2026-10-11T12:05:00Z',
        endsAt: '2026-10-11T12:50:00Z',
      },
    ],
  ],
  [
    ['participation', PARTICIPATION_RANGE.from, PARTICIPATION_RANGE.to, null, null],
    PARTICIPATION_ROWS,
  ],
  [['attendance-kinds'], ATTENDANCE_KINDS],
  // The days 0212 declares for the event the recorder opens on.
  [
    ['attendance-days', 'capital_clash'],
    [
      { held_on: gameDate(new Date()), note: null },
      { held_on: '2026-09-19', note: null },
    ],
  ],
  // Today's Capital Clash, half ticked: the form opens on it.
  [
    ['event-attendance', 'capital_clash', gameDate(new Date())],
    new Map([
      [PLAYER.shane, true],
      [PLAYER.mira, false],
    ]),
  ],
  // Rows as the table stores them — one row per starred thing, two of its
  // three id columns null. useFavourites maps over this directly.
  [
    ['favourites'],
    [
      { favourite_id: 'f1', player_id: PLAYER.mira, alliance_id: null, server_id: null },
      { favourite_id: 'f2', player_id: null, alliance_id: ALLIANCE.rival, server_id: null },
      { favourite_id: 'f3', player_id: null, alliance_id: null, server_id: 582 },
    ],
  ],
  [
    ['favourite-detail', PLAYER.mira, ALLIANCE.rival],
    {
      players: [{ id: PLAYER.mira, label: 'Mira', server: 580 }],
      alliances: [{ id: ALLIANCE.rival, label: '[IRWF] Iron Wolves', server: 581 }],
      servers: [582],
    },
  ],
  [['sync-status'], { last_heartbeat_at: ago(0.2), is_live: true }],

  // Map (Task 6). See MAP_SERVER_ID/MAP_SEARCH_TERM above for why these two
  // keys are the ones useScannedServers/useSightingSearch will ask for.
  [['map', 'servers'], [{ serverId: MAP_SERVER_ID, sweptAt: ago(20) }]],
  [['map', 'atlas', MAP_SERVER_ID], atlasFixture()],
  [['map', 'trucks'], huntTrucksFixture()],
  [['map', 'stations'], new Map<number, { x: number; y: number }>()],
  [['map', 'missions', MAP_SERVER_ID], huntMissionsFixture()],
  [
    ['map', 'search', MAP_SERVER_ID, MAP_SEARCH_TERM],
    [
      {
        playerId: null,
        gameUid: 1190060554000581,
        name: 'ERHA SANGMAIMA',
        serverId: MAP_SERVER_ID,
        at: { x: 310, y: 622 },
        hqLevel: 34,
        capturedAt: ago(20),
      },
    ],
  ],

  // Schedule (0124). THE KEY IS COMPUTED, not written out, because the
  // calendar's query key carries the window it is looking at and that window
  // moves with the clock. A hand-typed key was right on the day it was typed
  // and matched nothing afterwards — the screen then renders its empty state,
  // which looks exactly like a calendar with nothing on it.
  [
    SCHEDULE_KEY,
    [
      {
        schedule_event_id: 'ev-bear',
        title: 'Bear hunt',
        body: 'Rally at the south gate. Bring stamina.',
        category: 'bear',
        starts_at: `${SCHEDULE_DAYS[2]}T20:00:00+00:00`,
        ends_at: null,
        source: 'manual',
        schedule_reminders: [{ reminder_id: 'r1', minutes_before: 30 }],
      },
      {
        schedule_event_id: 'ev-duel',
        title: 'Alliance duel',
        body: null,
        category: 'duel',
        starts_at: `${SCHEDULE_DAYS[0]}T02:00:00+00:00`,
        ends_at: `${SCHEDULE_DAYS[4]}T02:00:00+00:00`,
        source: 'manual',
        schedule_reminders: [],
      },
      {
        schedule_event_id: 'ev-reset',
        title: 'Weekly reset',
        body: null,
        category: null,
        starts_at: `${SCHEDULE_DAYS[0]}T02:00:00+00:00`,
        ends_at: null,
        source: 'manual',
        schedule_reminders: [{ reminder_id: 'r2', minutes_before: 1440 }],
      },
    ],
  ],
  [
    ['schedule', 'channels'],
    ['alarm', 'general'],
  ],
  [
    ['schedule', 'categories'],
    [
      { category: 'bear', label: 'Bear hunt', colour: '#c2410c', channel: 'alarm', sort_order: 10 },
      {
        category: 'duel',
        label: 'Alliance duel',
        colour: '#1d4ed8',
        channel: null,
        sort_order: 20,
      },
    ],
  ],

  // Overview
  [
    ['overview', 'servers'],
    [577, 578, 580, 584, 586, 588].map((serverId, index) => ({
      serverId,
      alliances: 12 - index,
      members: 900 - index * 80,
      power: 4_200_000_000 - index * 300_000_000,
      lastSeen: ago(30 + index * 45),
    })),
  ],
  [
    ['overview'],
    {
      allianceName: 'HELLBOUND',
      allianceCode: 'CBFW',
      allianceCount: 1,
      serverIds: [577, 578, 579, 580, 581, 582, 583, 584],
      rosterObservedAt: ago(35),
      values: {
        total_power: 4_120_000_000,
        members: 93,
        kills: 214_000_000,
        online: 17,
        daily_donation: 6_240_000,
        weekly_donation: 41_800_000,
        duel_daily: 2_190_000,
        duel_weekly: 15_600_000,
        duel_round: 48_900_000,
        alliance_power: 4_120_000_000,
        alliance_members: 93,
      },
    },
  ],
  // `formulas` is not optional: OverviewPanel iterates it unguarded. It is
  // always empty now — a formula is a member column since 0048, and the
  // panel hardcodes that.
  [
    ['overview-metrics'],
    { tiles: ['alliance_power', 'members', 'online', 'weekly_donation'], formulas: [] },
  ],
  [
    ['overview-metrics-admin'],
    { tiles: ['alliance_power', 'members', 'online', 'weekly_donation'] },
  ],

  // Hive formation. A 3x3 block on a three-tile pitch — small enough to read
  // at a glance and big enough that a wrong pitch would be obvious, since
  // every base would be sitting on its neighbour.
  [
    ['hive', 'servers'],
    [580, 581],
  ],
  [['hive', 'formations', null], HIVE_FORMATIONS],
  [['hive', 'formations', 580], HIVE_FORMATIONS],
  [['hive', 'board', HIVE_FORMATION_ID], HIVE_SLOTS],
  [['hive', 'members'], HIVE_MEMBERS],
  [
    ['blackMoney', 'battles'],
    [
      {
        alliance_external_id: 'ours',
        battle_ended_at: '2026-09-27T21:50:00Z',
        team_index: 1,
        state: 2,
        score: 512004,
        user_num: 19,
        max_user_num: 20,
        enemy_name: '100 Thieves',
        enemy_abbr: '1OOT',
        enemy_score: 63091,
        enemy_user_num: 22,
        signup_read_at: '2026-09-27T09:00:00Z',
        starters: 20,
        substitutes: 6,
        players_scored: 0,
        report_seen: false,
      },
      {
        alliance_external_id: 'ours',
        battle_ended_at: '2026-09-27T12:50:00Z',
        team_index: 2,
        state: 2,
        score: 382529,
        user_num: 21,
        max_user_num: 20,
        enemy_name: 'RENASCENCE',
        enemy_abbr: 'RENS',
        enemy_score: 284451,
        enemy_user_num: 22,
        signup_read_at: '2026-09-27T09:00:00Z',
        starters: 20,
        substitutes: 9,
        players_scored: 21,
        report_seen: true,
      },
      {
        alliance_external_id: 'ours',
        battle_ended_at: '2026-09-13T21:50:00Z',
        team_index: 1,
        state: 2,
        score: 665292,
        user_num: 17,
        max_user_num: 20,
        enemy_name: 'Vanguard of Wreckage',
        enemy_abbr: 'VOW',
        enemy_score: 142512,
        enemy_user_num: 22,
        signup_read_at: null,
        starters: null,
        substitutes: null,
        players_scored: 17,
        report_seen: true,
      },
      {
        alliance_external_id: 'ours',
        battle_ended_at: '2026-09-13T03:50:00Z',
        team_index: 2,
        state: 3,
        score: 92414,
        user_num: 18,
        max_user_num: 20,
        enemy_name: 'My Farm, My Rules.',
        enemy_abbr: 'MFR',
        enemy_score: 654808,
        enemy_user_num: 22,
        signup_read_at: null,
        starters: null,
        substitutes: null,
        players_scored: null,
        report_seen: null,
      },
    ],
  ],
  [
    ['blackMoney', 'misses', 'ours'],
    [
      {
        game_uid: 9101000000000580,
        starter_misses: 0,
        substitute_misses: 0,
        starter_battles: 2,
        substitute_battles: 0,
      },
      {
        game_uid: 9102000000000580,
        starter_misses: 1,
        substitute_misses: 0,
        starter_battles: 2,
        substitute_battles: 0,
      },
      {
        game_uid: 9103000000000580,
        starter_misses: 0,
        substitute_misses: 1,
        starter_battles: 0,
        substitute_battles: 2,
      },
      {
        game_uid: 9104000000000580,
        starter_misses: 2,
        substitute_misses: 0,
        starter_battles: 2,
        substitute_battles: 0,
      },
    ],
  ],
  [
    ['blackMoney', 'opponents', '2026-09-27T12:50:00Z', 2],
    [
      {
        game_uid: 1500000000000581,
        player_id: null,
        name: 'Rival One',
        server_id: 581,
        opponent_abbr: 'RENS',
        score: 402830,
        kill_score: 281981,
        occupy_score: 80566,
        first_occupy_score: 2000,
        collect_score: 38283,
        escort_score: 0,
      },
      {
        game_uid: 1500000000000582,
        player_id: null,
        name: 'Rival Two',
        server_id: 581,
        opponent_abbr: 'RENS',
        score: 188211,
        kill_score: 131747,
        occupy_score: 37642,
        first_occupy_score: 2000,
        collect_score: 16821,
        escort_score: 0,
      },
      {
        game_uid: 1500000000000583,
        player_id: null,
        name: 'Rival Three',
        server_id: 581,
        opponent_abbr: 'RENS',
        score: 16012,
        kill_score: 11208,
        occupy_score: 3202,
        first_occupy_score: 2000,
        collect_score: 0,
        escort_score: 0,
      },
    ],
  ],
  [
    ['blackMoney', 'members', '2026-09-27T12:50:00Z', 2],
    [
      {
        game_uid: 9101000000000580,
        player_id: PLAYER.shane,
        name: 'Shane',
        slot: 'starter',
        played: true,
        score: 578571,
        kill_score: 404999,
        occupy_score: 115714,
        first_occupy_score: 2000,
        collect_score: 55857,
        escort_score: 0,
      },
      {
        game_uid: 9102000000000580,
        player_id: PLAYER.mira,
        name: 'Mira',
        slot: 'starter',
        played: true,
        score: 286880,
        kill_score: 200816,
        occupy_score: 57376,
        first_occupy_score: 2000,
        collect_score: 26688,
        escort_score: 0,
      },
      {
        game_uid: 9103000000000580,
        player_id: null,
        name: 'Kova',
        slot: 'substitute',
        played: true,
        score: 169019,
        kill_score: 118313,
        occupy_score: 33803,
        first_occupy_score: 2000,
        collect_score: 14901,
        escort_score: 0,
      },
      {
        game_uid: 9104000000000580,
        player_id: PLAYER.dex,
        name: 'Dex',
        slot: 'starter',
        played: false,
        score: null,
        kill_score: null,
        occupy_score: null,
        first_occupy_score: null,
        collect_score: null,
        escort_score: null,
      },
      {
        game_uid: 9105000000000580,
        player_id: null,
        name: 'Late Joiner',
        slot: null,
        played: true,
        score: 16012,
        kill_score: 11208,
        occupy_score: 3202,
        first_occupy_score: 2000,
        collect_score: 1601,
        escort_score: 0,
      },
    ],
  ],
  // The catalogue the brush loads from. The three 0171 seeds, plus one an
  // officer would have added — a 6x4 is the case that shows the chip is
  // reading the row's own size rather than printing 3x3 at everything.
  [
    ['hive', 'features'],
    [
      {
        featureId: '55555555-5555-4555-8555-555555555501',
        name: 'Member base',
        spanX: 3,
        spanY: 3,
        kind: 'base',
        colour: null,
        note: 'The default. One member stands here.',
        sortOrder: 10,
      },
      {
        featureId: '55555555-5555-4555-8555-555555555502',
        name: 'Frankie',
        spanX: 4,
        spanY: 3,
        kind: 'structure',
        colour: 'amber',
        note: 'Four wide, three tall, on the anchor.',
        sortOrder: 20,
      },
      {
        featureId: '55555555-5555-4555-8555-555555555503',
        name: 'Keep clear',
        spanX: 1,
        spanY: 1,
        kind: 'structure',
        colour: 'red',
        note: 'One tile nobody may build on.',
        sortOrder: 30,
      },
      {
        featureId: '55555555-5555-4555-8555-555555555504',
        name: 'Depot',
        spanX: 6,
        spanY: 4,
        kind: 'structure',
        colour: 'teal',
        note: '',
        sortOrder: 40,
      },
    ],
  ],

  // Saved shapes. Two, because one cannot show that the picker distinguishes
  // them, and the counts differ so a hardcoded 'n tiles' would be visible.
  [
    ['hive', 'templates'],
    [
      {
        templateId: '66666666-6666-4666-8666-666666666601',
        name: 'Bear rally',
        note: 'Tight pack, gate facing east.',
        tiles: 9,
        bases: 8,
        structures: 1,
        updatedAt: ago(2880),
      },
      {
        templateId: '66666666-6666-4666-8666-666666666602',
        name: 'Wide hive',
        note: '',
        tiles: 25,
        bases: 25,
        structures: 0,
        updatedAt: ago(14400),
      },
    ],
  ],

  // Members
  [['roster'], ROSTER],
  [['member-formulas'], []],
  [['member-formulas-admin'], []],

  // Rankings and cross-server
  [['rankings'], ALLIANCE_ROWS],
  ...(['power', 'kills', 'duel', 'donation'] as const).map(
    (board): [readonly unknown[], unknown] => [['crossRankings', board], CROSS_ROWS],
  ),

  // Arena — no board captured, which is a real and common state worth seeing.
  [['arena', 'boards'], []],

  // Server migration — one event, window open (settled_at null), a few moves.
  [
    ['migration', 'events'],
    [{ event_id: MIGRATION_ID, name: 'Migration 1', baseline_at: ago(4320), settled_at: null }],
  ],
  [
    ['migration', 'servers', MIGRATION_ID],
    [
      migrationServer(580, {
        tracked_before: 96,
        tracked_after: 88,
        stayed: 84,
        moved_out: 6,
        moved_in: 1,
        unseen_after: 6,
        appeared: 3,
        power_out: 2_900_000_000,
        power_in: 410_000_000,
        top_before: 24,
        top_after: 21,
        top_power_before: 14_800_000_000,
        top_power_after: 13_100_000_000,
      }),
      migrationServer(581, {
        tracked_before: 20,
        tracked_after: 27,
        stayed: 18,
        moved_in: 5,
        unseen_after: 2,
        appeared: 4,
        power_in: 2_400_000_000,
        top_before: 19,
        top_after: 23,
        top_power_before: 11_200_000_000,
        top_power_after: 13_900_000_000,
      }),
      migrationServer(584, {
        tracked_before: 14,
        tracked_after: 12,
        stayed: 11,
        moved_out: 1,
        moved_in: 1,
        unseen_after: 2,
        power_out: 410_000_000,
        power_in: 500_000_000,
        top_before: 17,
        top_after: 17,
        top_power_before: 9_600_000_000,
        top_power_after: 9_700_000_000,
      }),
    ],
  ],
  [
    ['migration', 'flows', MIGRATION_ID],
    [
      { from_server_id: 580, to_server_id: 581, movers: 5, top_movers: 3, power: 2_400_000_000 },
      { from_server_id: 580, to_server_id: 584, movers: 1, top_movers: 1, power: 500_000_000 },
      { from_server_id: 584, to_server_id: 580, movers: 1, top_movers: 0, power: 410_000_000 },
    ],
  ],
  [
    ['migration', 'top', MIGRATION_ID],
    [
      migrationPerson(1, 'Mira', 'moved', [580, 581], [1_160_000_000, 1_190_000_000], [1, 1]),
      migrationPerson(2, 'Kova', 'stayed', [580, 580], [990_000_000, 1_010_000_000], [2, 2]),
      migrationPerson(3, 'Dex', 'unseen_after', [584, null], [870_000_000, null], [3, null]),
      migrationPerson(4, 'Shane', 'appeared', [null, 581], [null, 800_000_000], [null, 4]),
    ],
  ],
  [
    ['migration', 'alliances', MIGRATION_ID],
    [
      {
        external_id: 'aaaa0000000000000000000000000001',
        name: 'Our Alliance',
        code: 'OUR',
        before_server_id: 580,
        after_server_id: 580,
        roster_before_at: ago(4400),
        roster_after_at: ago(60),
        members_before: 94,
        members_after: 90,
        roster_power_before: 38_000_000_000,
        roster_power_after: 36_500_000_000,
        stayed: 86,
        left_alliance: 8,
        left_by_moving: 5,
        joined: 4,
        board_power_before: 38_100_000_000,
        board_power_after: 36_600_000_000,
        board_members_before: 94,
        board_members_after: 90,
      },
      {
        external_id: 'aaaa0000000000000000000000000002',
        name: 'Rival',
        code: 'RVL',
        before_server_id: 580,
        after_server_id: 581,
        roster_before_at: ago(5000),
        roster_after_at: null,
        members_before: 88,
        members_after: null,
        roster_power_before: 30_000_000_000,
        roster_power_after: null,
        stayed: null,
        left_alliance: null,
        left_by_moving: null,
        joined: null,
        board_power_before: 30_200_000_000,
        board_power_after: 31_000_000_000,
        board_members_before: 88,
        board_members_after: 91,
      },
    ],
  ],

  // Detail pages, ids matching the roster above so links work.
  [
    ['player', PLAYER.shane],
    {
      // Non-null because the fixture session is an admin; a member's query
      // returns no row and the whole Subscriptions section stays off (0092).
      subscription: {
        month_card_expires_at: ahead(18),
        vip_level: 9,
        vip_expires_at: ahead(100),
        svip_level: null,
      },
      playerId: PLAYER.shane,
      gameUid: 58001,
      name: 'Shane',
      serverId: 580,
      allianceId: ALLIANCE.ours,
      allianceName: 'HELLBOUND',
      allianceCode: 'CBFW',
      isOwnAlliance: true,
      hqLevel: 30,
      power: 61_200_000,
      kills: 5_400_000,
      lastSeenAt: ago(35),
      onlineState: 'offline',
      offlineSince: ago(180),
      observedAt: ago(35),
      contributions: {
        daily_donation_score: 120_000,
        weekly_donation_score: 860_000,
        duel_daily_score: 44_000,
        duel_weekly_score: 310_000,
        duel_round_score: 1_020_000,
      },
      rank: { assigned: 'R5', computed: 'R1', score: 91.2 },
      growth: {
        growth1d: 0.004,
        growth7d: 0.031,
        power1dAt: ago(60 * 26),
        power7dAt: ago(60 * 24 * 7),
      },
      // The 0069 fallback. Both fixed baselines above are present, so the
      // page should NOT render this tile — which is itself worth seeing.
      recentGrowth: {
        growthSinceLast: 0.018,
        powerPrev: 60_100_000,
        powerPrevAt: ago(60 * 30),
        powerAt: ago(35),
      },
      componentPower: [
        { metric: 'hero_power', power: 21_400_000, rank: 3 },
        { metric: 'troop_power', power: 33_900_000, rank: 1 },
        { metric: 'pet_power', power: 5_900_000, rank: null },
      ],
      arena: [],
      pastNames: [{ name: 'Shayne', lastSeenAt: ago(60 * 24 * 40) }],
    },
  ],
  [
    ['member-history', PLAYER.shane],
    [
      {
        snapshot_id: 'h1',
        captured_at: ago(60 * 72),
        power: 58_900_000,
        kills: 5_200_000,
        member_rank: 5,
        presence_redacted: false,
        online_state: 'offline',
      },
      {
        snapshot_id: 'h2',
        captured_at: ago(60 * 71),
        power: 58_900_000,
        kills: 5_200_000,
        member_rank: 5,
        presence_redacted: false,
        online_state: 'offline',
      },
      {
        snapshot_id: 'h3',
        captured_at: ago(60 * 48),
        power: 60_100_000,
        kills: 5_310_000,
        member_rank: 5,
        presence_redacted: false,
        online_state: 'online',
      },
      // Captured from outside the alliance: presence is not an observation.
      {
        snapshot_id: 'h4',
        captured_at: ago(60 * 30),
        power: 60_100_000,
        kills: 5_310_000,
        member_rank: 5,
        presence_redacted: true,
        online_state: 'online',
      },
      // Power was not read in this capture.
      {
        snapshot_id: 'h5',
        captured_at: ago(60 * 4),
        power: null,
        kills: 5_400_000,
        member_rank: 5,
        presence_redacted: false,
        online_state: 'offline',
      },
      {
        snapshot_id: 'h6',
        captured_at: ago(35),
        power: 61_200_000,
        kills: 5_400_000,
        member_rank: 5,
        presence_redacted: false,
        online_state: 'offline',
      },
    ],
  ],
  // The same captures member-history shows, as player_power_history rows.
  // Board readings carry a rank; the profile reading (h5, power unread) does
  // not exist here because that capture never wrote a power row.
  [
    ['player-trend', PLAYER.shane],
    [
      {
        captured_at: ago(60 * 72),
        power: 58_900_000,
        hq_level: 30,
        kills: 5_200_000,
        rank: 34,
        source_command: 'server.rank',
        board_size: 100,
      },
      {
        captured_at: ago(60 * 48),
        power: 60_100_000,
        hq_level: 30,
        kills: 5_310_000,
        rank: 33,
        source_command: 'server.rank',
        board_size: 100,
      },
      // Read from the profile card, not a board — no rank to carry.
      {
        captured_at: ago(60 * 30),
        power: 60_100_000,
        hq_level: 30,
        kills: 5_310_000,
        rank: null,
        source_command: 'get.new.user.info',
        board_size: null,
      },
      {
        captured_at: ago(35),
        power: 61_200_000,
        hq_level: 30,
        kills: 5_400_000,
        rank: 32,
        source_command: 'server.rank',
        board_size: 100,
      },
    ],
  ],
  [
    ['alliance', ALLIANCE.ours],
    {
      allianceId: ALLIANCE.ours,
      name: 'HELLBOUND',
      code: 'CBFW',
      serverId: 580,
      power: 4_120_000_000,
      memberCount: 93,
      isOwn: true,
      rosterUnredactedSeen: true,
      lastSeenAt: ago(40),
      members: ROSTER.map((row) => ({
        playerId: row.player_id,
        name: row.current_name,
        gameUid: 58000,
        power: row.power,
        hqLevel: row.hq_level,
      })),
      pastNames: [
        { name: 'HELLBOUND', code: 'HELL', lastSeenAt: ago(60 * 24 * 20) },
        { name: 'Hellbound Legion', code: 'HELL', lastSeenAt: ago(60 * 24 * 60) },
        { name: 'Legion', code: null, lastSeenAt: ago(60 * 24 * 94) },
      ],
    },
  ],
  [
    ['server', 580],
    {
      alliances: ALLIANCE_ROWS.filter((row) => row.server_id === 580),
      players: ROSTER.map((row) => ({
        player_id: row.player_id,
        current_name: row.current_name,
        game_uid: 58000,
        hq_level: row.hq_level,
        power: row.power,
        kills: row.kills,
        last_seen_at: row.last_seen_at,
        current_alliance_id: ALLIANCE.ours,
      })),
    },
  ],

  // Admin — Access
  //
  // Typed, unlike most of this file. The five fields below `player_id` were
  // all absent, and an absent `created_at` took down the whole Admin tab:
  // `new Date(undefined)` is an Invalid Date and Intl throws
  // "Invalid time value" on it, while the component's guard tests
  // `=== null`, which undefined is not. FIXTURES is `unknown`-valued by
  // design — it seeds a query cache, so there is no one shape to declare —
  // and nothing caught the gap until the page went white. `satisfies` on
  // this one array puts tsc back in the loop for the row that crashed.
  [
    ['members-admin'],
    [
      {
        user_id: '33333333-3333-4333-8333-333333333301',
        display_name: 'you',
        role: 'admin',
        game_rank: 'R5',
        player_id: PLAYER.shane,
        email: 'you@example.com',
        last_sign_in_at: ago(14),
        created_at: ago(60 * 24 * 220),
        alliance_role: 'admin',
        other_alliances: 0,
      },
      // In both of our alliances, so Remove means "out of this one", and the
      // button says so instead of offering to delete the account.
      {
        user_id: '33333333-3333-4333-8333-333333333302',
        display_name: 'Mira',
        role: 'officer',
        game_rank: 'R4',
        player_id: PLAYER.mira,
        email: 'mira@example.com',
        last_sign_in_at: ago(90),
        created_at: ago(60 * 24 * 95),
        alliance_role: 'officer',
        other_alliances: 1,
      },
      // Signed in, never linked — the state the history screen has to explain.
      // Also never signed in, for the badge beside the address, and a viewer,
      // so the Remove column has nothing left to take.
      //
      // `created_at` is deliberately NOT null here: `app_users.created_at` is
      // `not null` (0002) and `app_user_directory` reads that column (0201),
      // so a null is an impossible state, and a fixture of an impossible state
      // teaches the UI to handle something it will never be given.
      {
        user_id: '33333333-3333-4333-8333-333333333303',
        display_name: null,
        role: 'viewer',
        game_rank: null,
        player_id: null,
        email: 'newcomer@example.com',
        last_sign_in_at: null,
        created_at: ago(60 * 3),
        alliance_role: 'viewer',
        other_alliances: 0,
      },
    ] satisfies AppUser[],
  ],
  // Admin — Access, "Waiting to join". Unseeded until now, so the section
  // could not be looked at at all.
  //
  // One of the two has no signup date. That one IS reachable —
  // `auth.users.created_at` is nullable — and it is the case the table got
  // wrong: unguarded, `new Date(null)` is the epoch, so the row read
  // "1 Jan 1970" rather than admitting it did not know.
  [
    ['waiting-to-join'],
    [
      {
        user_id: '33333333-3333-4333-8333-333333333304',
        email: 'asked.nicely@example.com',
        created_at: ago(60 * 30),
      },
      {
        user_id: '33333333-3333-4333-8333-333333333305',
        email: 'no.signup.date@example.com',
        created_at: null,
      },
    ] satisfies Waiting[],
  ],
  [
    ['linkable-players'],
    ROSTER.map((row) => ({ player_id: row.player_id, current_name: row.current_name })),
  ],
  [
    ['join-codes'],
    [
      {
        code_id: 'jc1',
        code: 'K7MQD-9XRAV',
        grants_role: 'member',
        max_uses: 100,
        used_count: 12,
        expires_at: new Date(NOW + 20 * 86_400_000).toISOString(),
        note: 'alliance chat, 2026-08',
        revoked_at: null,
        created_at: ago(60 * 24 * 3),
      },
      {
        code_id: 'jc2',
        code: 'TRWEY-346HC',
        grants_role: 'officer',
        max_uses: 2,
        used_count: 2,
        expires_at: null,
        note: null,
        revoked_at: null,
        created_at: ago(60 * 24 * 20),
      },
      {
        code_id: 'jc3',
        code: 'PNAUX-K4M7D',
        grants_role: 'member',
        max_uses: null,
        used_count: 4,
        expires_at: null,
        note: 'leaked, killed it',
        revoked_at: ago(60 * 24 * 2),
        created_at: ago(60 * 24 * 30),
      },
    ],
  ],

  // Admin — Alliance
  [['admin-own-alliance'], { alliance_id: ALLIANCE.ours, current_name: 'HELLBOUND' }],
  [['rank-tiers'], []],
  [['rank-report'], []],
  // One of each state the entry screen draws: captured (no box), typed (a
  // box to correct it), and nothing yet.
  [
    ['week-scores', recentWeeks(new Date(), 1)[0]],
    [
      {
        player_id: PLAYER.dex,
        current_name: 'Dex',
        duel: null,
        duel_typed: null,
        donation: null,
        donation_typed: null,
      },
      {
        player_id: PLAYER.mira,
        current_name: 'Mira',
        duel: 1_850_000,
        duel_typed: true,
        donation: null,
        donation_typed: null,
      },
      {
        player_id: PLAYER.shane,
        current_name: 'Shane',
        duel: 2_400_000,
        duel_typed: false,
        donation: 91_000,
        donation_typed: false,
      },
    ],
  ],

  // The overview's notice block. PINNED ONLY now — the rest are on the Notices
  // board — so a fixture of unpinned rows would show an empty block and look
  // like a bug. The editor's own key (`announcements-admin`) is gone with the
  // settings screen that owned it.
  [
    ['announcements'],
    [
      {
        announcement_id: '44444444-4444-4444-8444-444444444401',
        title: 'Welcome to CBFW dashboard!!',
        body: 'Titles only here. The body opens in a dialog, and every notice is on the **Notices** board.',
        starts_at: null,
        ends_at: null,
        pinned: true,
        visibility: 'member',
        created_at: ago(60 * 24),
      },
    ],
  ],

  // Admin — Catalogue
  [
    ['heroes'],
    new Map([
      [40002, { hero_id: 40002, name: 'Pyro Pup', troop_class: 1, grade: 3, notes: '' }],
      [1017, { hero_id: 1017, name: 'Mia', troop_class: 2, grade: 2, notes: '' }],
    ]),
  ],
  [['heroes-admin'], []],
  [
    ['pets'],
    new Map([
      [101, { pet_id: 101, name: 'Owlet', notes: '', rarity: 1 }],
      [106, { pet_id: 106, name: 'Rex', notes: '', rarity: 4 }],
    ]),
  ],
  [
    ['planner-catalog', 'vehicle', 'maxima'],
    new Map([['0', { subject: '0', name: 'Vehicle', maxLevel: 500, category: null }]]),
  ],
  [
    ['planner-catalog', 'vehicle_part', 'maxima'],
    new Map([
      ['1', { subject: '1', name: 'Engine', maxLevel: 66, category: null }],
      ['2', { subject: '2', name: 'Armor', maxLevel: 66, category: null }],
    ]),
  ],
  [
    ['planner-catalog', 'pet', 'maxima'],
    new Map([
      ['1', { subject: '1', name: null, maxLevel: 60, category: null }],
      ['4', { subject: '4', name: null, maxLevel: 100, category: null }],
    ]),
  ],
  [
    ['account-state', PLAYER.shane],
    {
      capturedAt: '2026-10-05T19:20:34Z',
      heroLevels: { '40002': 108, '1017': 97, '1016': 40 },
      squads: [
        { index: 1, heroes: [40002, 1017] },
        { index: 2, heroes: [] },
      ],
      gear: [
        { equipId: 410100, heroId: 40002, level: 100, promote: 24 },
        { equipId: 410200, heroId: 40002, level: 88, promote: 0 },
      ],
      exclusives: { '40002': 42 },
      vehicleParts: { '1': 35, '2': 34 },
      vehicle: { level: 279, exp: 1200, suit_level: 27 },
      pets: [
        { pet_id: 101, level: 60, breakthrough: 60, training: { '1': 90, '2': 80 } },
        { pet_id: 106, level: 83, breakthrough: 80, training: { '1': 161, '2': 150 } },
      ],
    },
  ],
  [['pets-admin'], []],

  // Admin — Operations
  [
    ['collectors'],
    [
      {
        collector_id: 'c1',
        name: 'win-desktop',
        status: 'healthy',
        version: '0.5.0',
        last_heartbeat_at: ago(0.1),
        last_packet_at: ago(0.4),
        last_sync_at: ago(0.2),
        outbox_depth: 0,
      },
      {
        collector_id: 'c2',
        name: 'spare-laptop',
        status: 'healthy',
        version: '0.4.9',
        last_heartbeat_at: ago(60 * 74),
        last_packet_at: ago(60 * 74),
        last_sync_at: null,
        outbox_depth: 1841,
      },
      {
        collector_id: 'c3',
        name: 'never-started',
        status: 'offline',
        version: null,
        last_heartbeat_at: null,
        last_packet_at: null,
        last_sync_at: null,
        outbox_depth: null,
      },
    ],
  ],
  [
    ['workflow-runs'],
    [
      {
        run_id: 'r1',
        collector_id: 'c1',
        workflow: 'alliance_roster_sweep',
        status: 'succeeded',
        started_at: ago(22),
        finished_at: ago(20),
        error: null,
      },
      {
        run_id: 'r2',
        collector_id: 'c1',
        workflow: 'arena_board_sweep',
        status: 'running',
        started_at: ago(3),
        finished_at: null,
        error: null,
      },
      {
        run_id: 'r3',
        collector_id: 'c2',
        workflow: 'cross_server_rank',
        status: 'failed',
        started_at: ago(60 * 74),
        finished_at: ago(60 * 74),
        error: 'ADB device offline after 3 retries',
      },
    ],
  ],
  [
    ['schema-observations'],
    [
      {
        schema_observation_id: 's1',
        source_command: 'push.battle.round.batch',
        fingerprint: 'a91f4c2d8e77bb01a91f4c2d8e77bb01',
        sample: {
          rounds: [{ atk: { uid: 'integer', power: 'integer' }, result: 'integer' }],
          seq: 'integer',
        },
        seen_count: 4127,
        first_seen_at: ago(60 * 24 * 14),
        last_seen_at: ago(12),
      },
      {
        schema_observation_id: 's2',
        source_command: 'push.world.march.new',
        fingerprint: 'bb0177bb01a91f4c2d8e77bb01a91f4c',
        sample: { march: { id: 'integer', from: 'object', to: 'object' } },
        seen_count: 903,
        first_seen_at: ago(60 * 24 * 12),
        last_seen_at: ago(90),
      },
      {
        schema_observation_id: 's3',
        source_command: 'mori.note.draw',
        fingerprint: '77bb01a91f4c2d8e77bb01a91f4c2d8e',
        sample: { note: { id: 'integer', text: 'string' } },
        seen_count: 12,
        first_seen_at: ago(60 * 48),
        last_seen_at: ago(60 * 13),
      },
    ],
  ],

  // Month cards — unlinked from the nav, reachable at #/month-cards.
  [['monthCards'], []],

  // Hero and pet boards for one player. All four, because they are captured
  // together — and with the hero total ten times its own best, which is the gap
  // the two axes exist for.
  [
    ['component-trend', PLAYER.shane],
    [0, 1, 2, 3, 4].flatMap((step) => {
      const at = ago(60 * 24 * (4 - step));
      return [
        {
          captured_at: at,
          metric: 'hero_power_total',
          metric_label: 'Hero power',
          family: 'hero',
          role: 'total',
          sort_order: 10,
          source_command: 'rank.get.by.range',
          power: 70_000_000 + step * 1_100_000,
          rank: 32 - step,
          unit_name: null,
          unit_grade: null,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'hero_power_best',
          metric_label: 'Strongest hero',
          family: 'hero',
          role: 'best',
          sort_order: 30,
          source_command: 'rank.get.by.range',
          power: 7_100_000 + step * 120_000,
          rank: 41 - step,
          unit_name: 'Tristan',
          unit_grade: 3,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'pet_power_total',
          metric_label: 'Pet power',
          family: 'pet',
          role: 'total',
          sort_order: 20,
          source_command: 'rank.get.by.range',
          power: 9_400_000 + step * 130_000,
          rank: 13,
          unit_name: null,
          unit_grade: null,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'pet_power_best',
          metric_label: 'Strongest pet',
          family: 'pet',
          role: 'best',
          sort_order: 40,
          source_command: 'rank.get.by.range',
          power: 3_100_000 + step * 30_000,
          rank: 19,
          unit_name: 'Zeus',
          unit_grade: null,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'migrate_power',
          metric_label: 'Migration power',
          family: 'account',
          role: 'other',
          sort_order: 50,
          source_command: 'get.user.info.multi',
          power: 26_500_000 + step * 140_000,
          rank: null,
          unit_name: null,
          unit_grade: null,
          board_size: null,
        },
        // 0109: the other four components of the profile's six-way power
        // decomposition. No board behind them — rank and board_size null.
        {
          captured_at: at,
          metric: 'building_power',
          metric_label: 'Building power',
          family: 'account',
          role: 'total',
          sort_order: 60,
          source_command: 'get.new.user.info',
          power: 8_100_000 + step * 60_000,
          rank: null,
          unit_name: null,
          unit_grade: null,
          board_size: null,
        },
        {
          captured_at: at,
          metric: 'science_power',
          metric_label: 'Tech power',
          family: 'account',
          role: 'total',
          sort_order: 70,
          source_command: 'get.new.user.info',
          power: 11_200_000 + step * 180_000,
          rank: null,
          unit_name: null,
          unit_grade: null,
          board_size: null,
        },
        {
          captured_at: at,
          metric: 'army_power',
          metric_label: 'Troop power',
          family: 'account',
          role: 'total',
          sort_order: 80,
          source_command: 'get.new.user.info',
          power: 33_900_000 + step * 700_000,
          rank: null,
          unit_name: null,
          unit_grade: null,
          board_size: null,
        },
        {
          captured_at: at,
          metric: 'mod_car_power',
          metric_label: 'Vehicle power',
          family: 'account',
          role: 'total',
          sort_order: 90,
          source_command: 'get.new.user.info',
          power: 3_800_000 + step * 40_000,
          rank: null,
          unit_name: null,
          unit_grade: null,
          board_size: null,
        },
      ];
    }),
  ],

  // What moved at the last rank period. One climber, one who slipped, one who
  // gained without changing band — which is the case the "biggest gain" card exists
  // for — and an officer with no tier at either end.
  [
    ['rank-movement'],
    [
      {
        player_id: PLAYER.mira,
        name: 'Mira',
        period_start: ago(60 * 24 * 3),
        previous_period_start: ago(60 * 24 * 17),
        tier: 'R3',
        previous_tier: 'R2',
        activity_score: 78.4,
        tier_change: 1,
        score_change: 31.2,
      },
      {
        player_id: PLAYER.kova,
        name: 'Kova',
        period_start: ago(60 * 24 * 3),
        previous_period_start: ago(60 * 24 * 17),
        tier: 'R1',
        previous_tier: 'R2',
        activity_score: 12.0,
        tier_change: -1,
        score_change: -22.6,
      },
      {
        player_id: PLAYER.dex,
        name: 'Dex',
        period_start: ago(60 * 24 * 3),
        previous_period_start: ago(60 * 24 * 17),
        tier: 'R2',
        previous_tier: 'R2',
        activity_score: 59.9,
        tier_change: 0,
        score_change: 40.5,
      },
      {
        player_id: PLAYER.shane,
        name: 'Shane',
        period_start: ago(60 * 24 * 3),
        previous_period_start: ago(60 * 24 * 17),
        tier: null,
        previous_tier: null,
        activity_score: 96.2,
        tier_change: null,
        score_change: 4.1,
      },
    ],
  ],

  // Which alliance is ours, for the nav tab that links straight to it.
  [['own-alliance'], { alliance_id: ALLIANCE.ours, name: 'HELLBOUND', code: 'CBFW' }],

  // One alliance's trends. The board readings come in PAIRS — a server board and
  // a cross-server board three minutes apart, same power, different rank — which
  // is the shape 0081 exists for and the only way to see the two rank lines
  // separate rather than sawtooth.
  [
    ['alliance-trends', ALLIANCE.ours],
    {
      board: [0, 1, 2, 3, 4].flatMap((step) => {
        const at = 60 * 24 * (5 - step);
        return [
          {
            captured_at: ago(at),
            server_id: 580,
            power: 17_500_000_000 + step * 90_000_000,
            rank: step < 2 ? 2 : 1,
            member_count: 94,
            board_scope: 'server',
            board_size: 39,
          },
          {
            captured_at: ago(at - 3),
            server_id: 580,
            power: 17_500_000_000 + step * 90_000_000,
            rank: 9 - step,
            member_count: 94,
            board_scope: 'cross_server',
            board_size: 100,
          },
        ];
      }),
      roster: [],
      daily: [],
    },
  ],

  // The two boards. Enough rows to put the pager on screen (22 unpinned at 20
  // a page), a pinned one above them, and a mix of read and unread — the three
  // things about a board list that can only be judged by looking at it.
  [['board', 'guides', 1], guideBoard(1)],
  [['board', 'guides', 2], guideBoard(2)],
  [['board', 'announcements', 1], noticeBoard()],

  // One post open, so the reader — the body through the safe markup subset, the
  // author line, the back link — can be looked at as well as the list.
  [
    ['post', 'guides', '33333333-3333-4333-8333-333333333399'],
    {
      post: {
        ...guideBoard(1).pinned[0],
        body: [
          '## What this is',
          '',
          'Everything left of the Guides tab is **observed** — the collector saw it in the',
          'game and wrote it down. This tab is the part people *wrote*.',
          '',
          '- Bullets work',
          '  - and nest one level',
          '- `code` too, and 🔥 emoji are just characters',
          '',
          'Links are allowlisted to http(s): https://example.invalid',
          '',
          '![a hero line-up](http://127.0.0.1:54321/storage/v1/object/public/post-images/u/1.png)',
          '',
          'An image from anywhere else stays text:',
          '![nope](https://example.invalid/tracker.png)',
        ].join('\n'),
      },
      author: AUTHORS[PLAYER.shane],
    },
  ],
];
