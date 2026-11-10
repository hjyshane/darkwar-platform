// What the alliance header says, as plain functions: the two status lights,
// the 7-day power change, and the three small reads the cells need beyond the
// page's own detail query. The component only lays these out.

import type { LedTone } from '../../components/console/Led';
import { compactNumber } from '../../lib/compactNumber';
import { formatAge } from '../../lib/freshness';
import { supabase } from '../../lib/supabase';
import type { StandingRow } from './verdict';

/** A roster read older than this is a warning, not yet an error: the alliance
 * has not stopped existing, we have stopped looking. */
export const ROSTER_WARN_HOURS = 48;

export interface LedFact {
  tone: LedTone;
  /** Sentence case; the kit's stylesheet sets it in mono capitals. */
  text: string;
  /** The long form, for hover. */
  title: string;
}

/** How fresh the roster read is. Absent when no roster was ever captured,
 * which is every alliance but ours: a grey light there would say "unknown"
 * about something nobody expected to know. */
export function rosterLed(capturedAt: string | null, now: Date): LedFact | null {
  if (capturedAt === null) return null;
  const hours = (now.getTime() - Date.parse(capturedAt)) / 3_600_000;
  const age = formatAge(capturedAt, now).replace(/ ago$/, '');
  return {
    tone: hours >= ROSTER_WARN_HOURS ? 'warn' : 'ok',
    text: `Roster ${age}`,
    title: `Newest roster capture: ${capturedAt}`,
  };
}

/** Whether the newest roster capture reached the end (0067 measures it against
 * the game's own member count). Only a roster list can be cut short. */
export function captureLed(
  membersFrom: 'roster' | 'last known',
  complete: boolean,
): LedFact | null {
  if (membersFrom !== 'roster') return null;
  return complete
    ? {
        tone: 'ok',
        text: 'Capture complete',
        title: 'The newest roster capture saw every member the game reports.',
      }
    : {
        tone: 'bad',
        text: 'Capture cut short',
        title:
          'The newest roster capture stopped before the end; a member missing from the list may not have been scrolled to.',
      };
}

export interface PowerReading {
  captured_at: string | null;
  power: number | null;
}

/** Power now minus power `days` ago: the newest reading against the newest one
 * at least that old. Null when either is missing, so a history that only goes
 * back two days shows no change rather than a two-day change labelled seven. */
export function powerDelta(readings: readonly PowerReading[], now: Date, days = 7): number | null {
  const usable = readings
    .filter(
      (row): row is { captured_at: string; power: number } =>
        row.captured_at !== null && row.power !== null,
    )
    .map((row) => ({ at: Date.parse(row.captured_at), power: row.power }))
    .sort((a, b) => b.at - a.at);
  const newest = usable[0];
  const cutoff = now.getTime() - days * 24 * 3_600_000;
  const before = usable.find((row) => row.at <= cutoff);
  if (newest === undefined || before === undefined) return null;
  return newest.power - before.power;
}

const compact = compactNumber(1);

/** `+1.2G`, `-340M`, `0`. An ASCII minus, like every other figure on the site. */
export function signedCompact(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${compact.format(Math.abs(value))}`;
}

/** One server's alliances as the ranking last reported them, for the standing. */
export async function fetchStanding(serverId: number): Promise<StandingRow[]> {
  const { data, error } = await supabase
    .from('alliance_latest')
    .select('alliance_id, power, code')
    .eq('server_id', serverId)
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

/** The alliance's recent power readings, newest first. */
export async function fetchPowerReadings(allianceId: string): Promise<PowerReading[]> {
  const { data, error } = await supabase
    .from('alliance_power_history')
    .select('captured_at, power')
    .eq('alliance_id', allianceId)
    .order('captured_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export interface Leader {
  playerId: string;
  name: string | null;
}

/** get.al.info gives the leader as a game uid; this is who that is. */
export async function fetchLeader(gameUid: number): Promise<Leader | null> {
  const { data, error } = await supabase
    .from('players')
    .select('player_id, current_name')
    .eq('game_uid', gameUid)
    .maybeSingle();
  if (error) throw error;
  return data === null ? null : { playerId: data.player_id, name: data.current_name };
}
