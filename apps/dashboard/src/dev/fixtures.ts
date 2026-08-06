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
    ...over,
  };
}

const ROSTER = [
  member(PLAYER.shane, 'Shane', 61_200_000, { assigned_rank: 'R5', computed_rank: 'R1' }),
  member(PLAYER.mira, 'Mira', 48_900_000, { assigned_rank: 'R4', online_state: 'online' }),
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
  member(PLAYER.dex, 'Dex', null, { kills: null, computed_rank: 'R3' }),
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
      tag: (['tip', 'strategy', 'info'] as const)[index % 3],
    },
    read,
  };
}

function guideBoard(page: number) {
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
  };
}

function noticeBoard() {
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
  };
}

/** Every key the app asks for, with the data it expects behind it.
 *
 * A key that is absent is not a mistake — the screen will render its own
 * "nothing here" state, which is worth looking at too. */
export const SESSION_KEY = ['session'] as const;

/** Held as a stable reference so main.tsx can tell "still the fixture" from
 *  "something replaced it" by identity. */
export const SESSION = { email: 'you@example.invalid', role: 'admin' };

export const FIXTURES: [readonly unknown[], unknown][] = [
  [SESSION_KEY, SESSION],
  [['permissions'], { capabilities: CAPABILITIES, grants: GRANTS }],
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

  // Overview
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

  // Detail pages, ids matching the roster above so links work.
  [
    ['player', PLAYER.shane],
    {
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
  [
    ['members-admin'],
    [
      {
        user_id: '33333333-3333-4333-8333-333333333301',
        display_name: 'you',
        role: 'admin',
        game_rank: 'R5',
        player_id: PLAYER.shane,
      },
      {
        user_id: '33333333-3333-4333-8333-333333333302',
        display_name: 'Mira',
        role: 'officer',
        game_rank: 'R4',
        player_id: PLAYER.mira,
      },
      // Signed in, never linked — the state the history screen has to explain.
      {
        user_id: '33333333-3333-4333-8333-333333333303',
        display_name: null,
        role: 'viewer',
        game_rank: null,
        player_id: null,
      },
    ],
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
  [['heroes'], []],
  [['heroes-admin'], []],
  [['pets'], []],
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
          power: 70_000_000 + step * 1_100_000,
          rank: 32 - step,
          unit_name: null,
          unit_grade: null,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'hero_power_best',
          power: 7_100_000 + step * 120_000,
          rank: 41 - step,
          unit_name: 'Tristan',
          unit_grade: 3,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'pet_power_total',
          power: 9_400_000 + step * 130_000,
          rank: 13,
          unit_name: null,
          unit_grade: null,
          board_size: 150,
        },
        {
          captured_at: at,
          metric: 'pet_power_best',
          power: 3_100_000 + step * 30_000,
          rank: 19,
          unit_name: 'Zeus',
          unit_grade: null,
          board_size: 150,
        },
      ];
    }),
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
