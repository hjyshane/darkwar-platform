import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SERVER_ZONE, fromInputValue, toInputValue } from '../../lib/timezone';
import type { MigrationEvent } from './data';

/** Add a migration, or set the two instants of the one on screen.
 *
 * Both times are typed on the game's clock (UTC−2), because that is the clock
 * the migration is announced on. The database decides who may write — the
 * form only shows what it said.
 */
export function MigrationEventForm({
  event,
  onSaved,
}: {
  event: MigrationEvent | null;
  onSaved: (eventId: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(event?.name ?? '');
  const [baseline, setBaseline] = useState(toInputValue(event?.baseline_at ?? null, SERVER_ZONE));
  const [settled, setSettled] = useState(toInputValue(event?.settled_at ?? null, SERVER_ZONE));

  const save = useMutation({
    mutationFn: async (): Promise<string> => {
      const baselineAt = fromInputValue(baseline, SERVER_ZONE);
      if (name.trim() === '' || baselineAt === null) {
        throw new Error('A name and a baseline time are both needed.');
      }
      const row = {
        name: name.trim(),
        baseline_at: baselineAt,
        settled_at: fromInputValue(settled, SERVER_ZONE),
      };
      const query =
        event === null
          ? supabase.from('migration_events').insert(row)
          : supabase.from('migration_events').update(row).eq('event_id', event.event_id);
      const { data, error } = await query.select('event_id').single();
      if (error) {
        throw new Error(error.message);
      }
      return data.event_id;
    },
    onSuccess: async (eventId) => {
      await client.invalidateQueries({ queryKey: ['migration'] });
      onSaved(eventId);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form className="migration-form" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Migration 1" />
      </label>
      <label>
        Before side read at <span className="muted">(server time)</span>
        <input
          type="datetime-local"
          value={baseline}
          onChange={(e) => setBaseline(e.target.value)}
        />
      </label>
      <label>
        After side settled at <span className="muted">(blank while the window is open)</span>
        <input type="datetime-local" value={settled} onChange={(e) => setSettled(e.target.value)} />
      </label>
      <button type="submit" disabled={save.isPending}>
        {event === null ? 'Add migration' : 'Save'}
      </button>
      {save.error && <p className="error">Not saved: {save.error.message}</p>}
    </form>
  );
}
