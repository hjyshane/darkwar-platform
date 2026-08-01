// Domain vocabulary, in the game's own English.
//
// Collected here rather than inlined so a term can be corrected in one
// place when a screenshot shows the game wording differs.
//
// PROVENANCE — most of these are not translations, they are the field
// names the game itself sends:
//
//   power, kills, rank, name, score      player/ranking payloads
//   heroPower, petPower                  get.new.user.info profile
//   heroId, petId                        rank.get.by.range entries
//   monthCardEndTime                     al.rank / server.rank / kill.rank
//   allianceName, abbr, serverId         ranking payloads
//
// The exceptions, marked below, are OURS because the game's screen names
// were never captured: the two "Top …" board labels (the payload only
// proves the board ranks a single hero/pet, via heroId/petId), "Last Seen"
// (last_seen_at is our column), and "Defense Power" (the arena entry field
// is `army`, an opaque lineup blob).

export const TERMS = {
  // Screens
  members: 'Members',
  allianceRanking: 'Alliance Ranking',
  crossServerRanking: 'Cross-Server Ranking',
  arena: 'Arena',
  monthlyCard: 'Monthly Card',
  signIn: 'Sign In',

  // Columns
  rank: 'Rank',
  name: 'Name',
  server: 'Server',
  alliance: 'Alliance',
  hq: 'HQ',
  power: 'Power',
  kills: 'Kills',
  score: 'Score',
  members_count: 'Members',
  status: 'Status',
  expires: 'Expires',
  lastOnline: 'Last Online', // ours: from al.rank offLineTime — when they last played
  lastSeen: 'Last Seen', // ours: last_seen_at — when the collector last looked
  observed: 'Observed', // ours: captured_at
  defensePower: 'Defense Power', // ours: the `army` blob is a lineup, not a number
  heroId: 'Hero ID',
  petId: 'Pet ID',

  // Contribution types (alliance_contribution_snapshots.contribution_type)
  dailyDonation: 'Daily Donation',
  allianceBattle: 'Alliance Battle',

  // Component power boards (rank.get.by.range)
  heroPower: 'Hero Power',
  petPower: 'Pet Power',
  topHero: 'Top Hero', // ours: the board carries heroId, so it ranks one hero
  topPet: 'Top Pet', // ours: likewise, petId
} as const;
