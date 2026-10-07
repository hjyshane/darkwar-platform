// Ticking who took part in an event (0204). Most events are captured by
// nobody; Furnace Fury is read from its member board (0212), and a tick here
// overrides the board for that member and day.
//
// One event, one game day, every current member: present, absent, or not
// recorded. Only what changed is sent, so correcting one member does not
// restamp everybody else as typed by whoever saved last.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  type EventKind,
  type Mark,
  type ParticipationRow,
  buildEntries,
  declareEventDay,
  fetchAttendanceDay,
  fetchEventDays,
  fetchScannedScores,
  parseScore,
  recordAttendance,
} from './data';
import { gameDate } from './periods';

const MARKS: ReadonlyArray<[Mark, string]> = [
  [true, 'Present'],
  [false, 'Absent'],
  [null, '—'],
];

export function AttendanceRecorder({
  kinds,
  members,
  now,
}: {
  kinds: EventKind[];
  members: ParticipationRow[];
  now: Date;
}) {
  const queryClient = useQueryClient();
  const today = gameDate(now);
  const [kind, setKind] = useState(kinds[0]?.kind ?? '');
  const [heldOn, setHeldOn] = useState(today);
  const [draft, setDraft] = useState<Map<string, Mark>>(new Map());
  // The score boxes' text, by member. Text, not numbers: a half-typed box is
  // not a score yet, and an emptied one means "clear it".
  const [draftScores, setDraftScores] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState<string | null>(null);

  function resetDraft() {
    setDraft(new Map());
    setDraftScores(new Map());
    setNote(null);
  }

  const stored = useQuery({
    queryKey: ['event-attendance', kind, heldOn],
    queryFn: () => fetchAttendanceDay(kind, heldOn),
    enabled: kind !== '' && heldOn !== '',
  });
  const onRecord = stored.data?.marks ?? new Map<string, boolean>();
  const onRecordScores = stored.data?.scores ?? new Map<string, number>();
  const scanned = useQuery({
    queryKey: ['event-scanned-scores', kind, heldOn],
    queryFn: () =>
      fetchScannedScores(
        kind,
        heldOn,
        members.map((member) => member.game_uid),
      ),
    enabled: kind === 'furnace_fury' && heldOn !== '',
  });
  const days = useQuery({
    queryKey: ['attendance-days', kind],
    queryFn: () => fetchEventDays(kind),
    enabled: kind !== '',
  });

  function markOf(playerId: string): Mark {
    return draft.has(playerId) ? (draft.get(playerId) ?? null) : (onRecord.get(playerId) ?? null);
  }

  function mark(playerId: string, value: Mark) {
    const next = new Map(draft);
    next.set(playerId, value);
    setDraft(next);
    setNote(null);
  }

  function scoreText(playerId: string): string {
    const typed = draftScores.get(playerId);
    if (typed !== undefined) return typed;
    const before = onRecordScores.get(playerId);
    return before === undefined ? '' : String(before);
  }

  function typeScore(playerId: string, text: string) {
    const next = new Map(draftScores);
    next.set(playerId, text);
    setDraftScores(next);
    // A score belongs to a tick: typing one on a member nobody has ticked
    // ticks them present, which is what typing a score means.
    if (text.trim() !== '' && markOf(playerId) === null) {
      mark(playerId, true);
    }
    setNote(null);
  }

  function markEveryone(value: Mark) {
    setDraft(new Map(members.map((member) => [member.player_id, value])));
    setNote(null);
  }

  // Boxes whose text is not a score. They block saving rather than being sent.
  const badScores = [...draftScores.entries()].filter(([, text]) => parseScore(text) === undefined);
  const parsedScores = new Map<string, number | null>();
  for (const [playerId, text] of draftScores) {
    const parsed = parseScore(text);
    if (parsed !== undefined) parsedScores.set(playerId, parsed);
  }
  const entries = buildEntries({ marks: onRecord, scores: onRecordScores }, draft, parsedScores);

  const save = useMutation({
    mutationFn: () => recordAttendance(kind, heldOn, entries),
    onSuccess: (written) => {
      setDraft(new Map());
      setDraftScores(new Map());
      setNote(`Saved ${written} change${written === 1 ? '' : 's'}.`);
      void queryClient.invalidateQueries({ queryKey: ['event-attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['participation'] });
    },
    onError: (error: Error) => setNote(error.message),
  });

  const declared = days.data?.some((day) => day.held_on === heldOn) ?? false;
  const declare = useMutation({
    mutationFn: () => declareEventDay(kind, heldOn, !declared),
    onSuccess: () => {
      setNote(declared ? 'Taken off the held days.' : 'Marked as held.');
      void queryClient.invalidateQueries({ queryKey: ['attendance-days'] });
      void queryClient.invalidateQueries({ queryKey: ['participation'] });
    },
    onError: (error: Error) => setNote(error.message),
  });

  const label = kinds.find((entry) => entry.kind === kind)?.label ?? kind;
  const present = members.filter((member) => markOf(member.player_id) === true).length;
  const absent = members.filter((member) => markOf(member.player_id) === false).length;

  return (
    <section aria-labelledby="attendance-heading">
      <h3 id="attendance-heading">Record attendance</h3>
      <p className="subtle">
        Pick the event and the game day it was held, tick each member, and save. Leaving somebody on
        — means not recorded, which the report shows as a gap rather than an absence. Furnace Fury
        is read from its member board; a tick here overrides the board for that member.
      </p>
      <div className="row">
        <label>
          Event{' '}
          <Select
            onChange={(chosen) => {
              setKind(chosen);
              resetDraft();
            }}
            value={kind}
          >
            {kinds.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </Select>
        </label>
        {(days.data ?? []).length > 0 && (
          <label>
            Held{' '}
            <Select
              onChange={(chosen) => {
                setHeldOn(chosen);
                resetDraft();
              }}
              value={days.data?.some((day) => day.held_on === heldOn) ? heldOn : ''}
            >
              <option value="">Pick a day…</option>
              {days.data?.map((day) => (
                <option key={day.held_on} value={day.held_on}>
                  {day.held_on}
                  {day.note ? ` · ${day.note}` : ''}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label>
          Held on (game day){' '}
          <input
            max={today}
            onChange={(event) => {
              setHeldOn(event.target.value);
              resetDraft();
            }}
            type="date"
            value={heldOn}
          />
        </label>
        <button
          disabled={declare.isPending || kind === '' || days.isPending}
          onClick={() => declare.mutate()}
          title={
            declared
              ? 'This day is on the list of days the event was held. Take it off.'
              : 'Count this day as one the event was held, even if nobody is ticked.'
          }
          type="button"
        >
          {declared ? 'Not held this day' : 'Mark as held'}
        </button>
        <button onClick={() => markEveryone(true)} type="button">
          Everyone present
        </button>
        <button onClick={resetDraft} type="button">
          Undo changes
        </button>
      </div>

      {stored.isPending ? (
        <p className="empty loading">Loading…</p>
      ) : stored.error ? (
        <p className="error">Could not load this day: {stored.error.message}</p>
      ) : (
        <>
          <p className="subtle">
            {label} on {heldOn}: {present} present, {absent} absent,{' '}
            {members.length - present - absent} not recorded.
          </p>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="label" scope="col">
                    Member
                  </th>
                  <th scope="col">Attendance</th>
                  <th className="num" scope="col">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const current = markOf(member.player_id);
                  const name = member.current_name ?? member.player_id.slice(0, 8);
                  return (
                    <tr key={member.player_id}>
                      <td className="label">{name}</td>
                      <td>
                        <fieldset className="row attendance-marks">
                          <legend className="visually-hidden">{name}</legend>
                          {MARKS.map(([value, text]) => (
                            <label key={text}>
                              <input
                                checked={current === value}
                                name={`attendance-${member.player_id}`}
                                onChange={() => mark(member.player_id, value)}
                                type="radio"
                              />{' '}
                              {text}
                            </label>
                          ))}
                        </fieldset>
                      </td>
                      <td className="num">
                        <input
                          aria-label={`Score for ${name}`}
                          inputMode="numeric"
                          min={0}
                          onChange={(event) => typeScore(member.player_id, event.target.value)}
                          placeholder={
                            scanned.data?.has(member.game_uid)
                              ? `scanned ${scanned.data.get(member.game_uid)?.toLocaleString('ko-KR')}`
                              : 'optional'
                          }
                          type="number"
                          value={scoreText(member.player_id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="row">
        <button
          disabled={entries.length === 0 || badScores.length > 0 || save.isPending}
          onClick={() => save.mutate()}
          type="button"
        >
          {save.isPending
            ? 'Saving…'
            : `Save ${entries.length} change${entries.length === 1 ? '' : 's'}`}
        </button>
        {note && <span className="subtle">{note}</span>}
      </div>
    </section>
  );
}
