import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Announcement } from '../overview/AnnouncementsBlock';

/** Write, edit and remove notices.
 *
 * Lists everything including expired ones — unlike the overview, which shows
 * only what is current. An admin editing the board needs to see the notice
 * that stopped appearing, or removing it is guesswork.
 *
 * created_by is stamped by a trigger and never sent from here (0034), so
 * this form has no field for it.
 */
type Draft = {
  announcement_id?: string;
  title: string;
  body: string;
  starts_at: string;
  ends_at: string;
  pinned: boolean;
  visibility: 'public' | 'member';
};

const EMPTY: Draft = {
  title: '',
  body: '',
  starts_at: '',
  ends_at: '',
  pinned: false,
  visibility: 'member',
};

async function fetchAll(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('announcement_id, title, body, starts_at, ends_at, pinned, visibility, created_at')
    .order('pinned', { ascending: false })
    .order('starts_at', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`announcements query failed: ${error.message}`);
  }
  return data ?? [];
}

/** `datetime-local` gives no zone, and the column is timestamptz. Read as
 *  UTC rather than as the admin's own clock: a notice about a 02:00 UTC
 *  reset typed by someone in Seoul must not land nine hours out. */
function toIso(local: string): string | null {
  return local.trim() === '' ? null : new Date(`${local}:00Z`).toISOString();
}

function toLocal(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 16);
}

export function AnnouncementsSetting() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const formId = useId();

  const { data, error, isPending } = useQuery({
    queryKey: ['announcements-admin'],
    queryFn: fetchAll,
  });

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      const row = {
        title: value.title.trim(),
        body: value.body,
        starts_at: toIso(value.starts_at),
        ends_at: toIso(value.ends_at),
        pinned: value.pinned,
        visibility: value.visibility,
      };
      const { error: writeError } = value.announcement_id
        ? await supabase
            .from('announcements')
            .update(row)
            .eq('announcement_id', value.announcement_id)
        : await supabase.from('announcements').insert(row);
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      setDraft(EMPTY);
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      setFailed(true);
      setMessage(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError, count } = await supabase
        .from('announcements')
        .delete({ count: 'exact' })
        .eq('announcement_id', id);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
      // A refused delete does not raise — RLS filters the rows the statement
      // can see, so a non-admin removes nothing and is told it worked. The
      // count is the only way to tell the two apart.
      if (count === 0) {
        throw new Error('Nothing was removed. That needs an admin.');
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Removed.');
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      setFailed(true);
      setMessage(e.message);
    },
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load notices: {error.message}</p>;
  }

  const busy = save.isPending || remove.isPending;
  return (
    <>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(draft);
        }}
      >
        <label htmlFor={`${formId}-title`}>
          Title
          <input
            id={`${formId}-title`}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            value={draft.title}
          />
        </label>
        <label htmlFor={`${formId}-body`}>
          Body
          <textarea
            id={`${formId}-body`}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={4}
            value={draft.body}
          />
        </label>
        <div className="row">
          <label htmlFor={`${formId}-from`}>
            From (UTC)
            <input
              id={`${formId}-from`}
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              type="datetime-local"
              value={draft.starts_at}
            />
          </label>
          <label htmlFor={`${formId}-to`}>
            To (UTC)
            <input
              id={`${formId}-to`}
              onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
              type="datetime-local"
              value={draft.ends_at}
            />
          </label>
          <label htmlFor={`${formId}-vis`}>
            Who sees it
            <select
              id={`${formId}-vis`}
              onChange={(e) =>
                setDraft({ ...draft, visibility: e.target.value as Draft['visibility'] })
              }
              value={draft.visibility}
            >
              <option value="member">Alliance only</option>
              <option value="public">Anyone</option>
            </select>
          </label>
        </div>
        <label className="inline" htmlFor={`${formId}-pin`}>
          <input
            checked={draft.pinned}
            id={`${formId}-pin`}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            type="checkbox"
          />
          Pin to the top
        </label>
        {/* Both dates are optional. A notice with neither is a standing one,
            which is the common case and should not require picking a date. */}
        <p className="subtle">
          Leave the dates empty for a standing notice. Times are UTC, the same clock the game week
          resets on.
        </p>
        <div className="row">
          <button disabled={busy} type="submit">
            {draft.announcement_id ? 'Save changes' : 'Post notice'}
          </button>
          {draft.announcement_id && (
            <button className="linklike" onClick={() => setDraft(EMPTY)} type="button">
              cancel
            </button>
          )}
        </div>
      </form>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {data.length === 0 ? (
        <p className="empty">No notices yet.</p>
      ) : (
        <ul className="notices">
          {data.map((item) => (
            <li className="notice" key={item.announcement_id}>
              <div className="notice-head">
                <strong>{item.title}</strong>
                {item.pinned && <span className="badge badge-fresh">pinned</span>}
                <span className="badge">
                  {item.visibility === 'public' ? 'anyone' : 'alliance'}
                </span>
                {item.ends_at !== null && new Date(item.ends_at) < new Date() && (
                  <span className="badge badge-missing">expired</span>
                )}
              </div>
              {item.body.trim() !== '' && <p className="notice-body">{item.body}</p>}
              <div className="row">
                <button
                  className="linklike"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      announcement_id: item.announcement_id,
                      title: item.title,
                      body: item.body,
                      starts_at: toLocal(item.starts_at),
                      ends_at: toLocal(item.ends_at),
                      pinned: item.pinned,
                      visibility: item.visibility === 'public' ? 'public' : 'member',
                    })
                  }
                  type="button"
                >
                  edit
                </button>
                <button
                  className="linklike"
                  disabled={busy}
                  onClick={() => remove.mutate(item.announcement_id)}
                  type="button"
                >
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
