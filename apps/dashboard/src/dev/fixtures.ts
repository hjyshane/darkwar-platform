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
  // Deliberately hours behind the heartbeat above. This pair IS the state the
  // badge was rewritten for — process alive, decoder dead — so the fixture
  // that shows the badge should show it saying so, not the easy agreeing case.
  [['sync-newest-observation'], ago(303)],

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

  // Admin — Display
  [['announcements'], []],
  [['announcements-admin'], []],

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
];
