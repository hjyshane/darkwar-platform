import { describe, expect, it } from 'vitest';
import {
  type Battle,
  type BattleMember,
  groupEvents,
  noShows,
  outcome,
  serverClock,
  teamLabel,
} from './data';

function battle(ended: string, team: number, state: number | null = 2): Battle {
  return {
    alliance_external_id: 'a',
    battle_ended_at: ended,
    team_index: team,
    state,
    score: 1,
    user_num: 20,
    max_user_num: 20,
    enemy_name: 'Them',
    enemy_abbr: 'THM',
    enemy_score: 0,
    enemy_user_num: 20,
    signup_read_at: null,
    starters: null,
    substitutes: null,
    players_scored: null,
    report_seen: null,
  };
}

function member(slot: BattleMember['slot'], played: boolean | null): BattleMember {
  return {
    game_uid: Math.floor(Math.random() * 1e9),
    player_id: null,
    name: 'x',
    slot,
    played,
    score: null,
    kill_score: null,
    occupy_score: null,
    first_occupy_score: null,
    collect_score: null,
    escort_score: null,
  };
}

describe('groupEvents', () => {
  it('puts both teams of one event on the same server day, A first', () => {
    // 09-27: B ends 12:50 UTC (10:50 server), A ends 21:50 UTC (19:50 server).
    const events = groupEvents([
      battle('2026-09-27T12:50:00Z', 2),
      battle('2026-09-27T21:50:00Z', 1),
      battle('2026-09-13T21:50:00Z', 1),
    ]);

    expect(events.map((e) => e.day)).toEqual(['2026-09-27', '2026-09-13']);
    expect(events[0]?.teams.map((t) => t.team_index)).toEqual([1, 2]);
  });

  it('buckets by the game clock, not UTC', () => {
    // 01:00 UTC on the 28th is 23:00 on the 27th at UTC−2.
    const [event] = groupEvents([battle('2026-09-28T01:00:00Z', 1)]);

    expect(event?.day).toBe('2026-09-27');
  });

  it('returns nothing for no battles', () => {
    expect(groupEvents([])).toEqual([]);
  });
});

describe('outcome', () => {
  it('reads state 2 as a win and 3 as a loss', () => {
    expect(outcome({ state: 2 })).toBe('win');
    expect(outcome({ state: 3 })).toBe('loss');
  });

  it('does not guess at any other state', () => {
    expect(outcome({ state: null })).toBe('unknown');
    expect(outcome({ state: 1 })).toBe('unknown');
  });
});

describe('noShows', () => {
  it('counts only listed players a report says did not play', () => {
    const members = [
      member('starter', true),
      member('starter', false),
      member('substitute', false),
      member(null, true),
    ];

    expect(noShows(members)).toHaveLength(2);
  });

  it('never infers a no-show without a report', () => {
    expect(noShows([member('starter', null), member('substitute', null)])).toEqual([]);
  });
});

describe('labels', () => {
  it('names the teams the way the alliance does', () => {
    expect(teamLabel(1)).toBe('Team A');
    expect(teamLabel(2)).toBe('Team B');
  });

  it('shows the end time on the game clock', () => {
    expect(serverClock('2026-09-27T12:50:00Z')).toBe('10:50 server');
  });
});
