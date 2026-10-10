import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { extractGiftKey, pasteProblem } from './giftKey';

interface MyKey {
  game_uid: number;
  name: string;
  has_key: boolean;
  updated_at: string | null;
}

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

async function fetchMyKeys(): Promise<MyKey[]> {
  const { data, error } = await supabase.rpc('my_gift_keys');
  if (error) {
    throw new Error(`could not load your Gift Center keys: ${error.message}`);
  }
  return (data ?? []) as MyKey[];
}

/** Save the Gift Center key of your own character (0273).
 *
 * WHAT THE KEY IS, said on the screen because it is the thing to decide on: a
 * login token for your Dark War store account. So it is write-only here (the
 * database never hands it back to anyone), it is used only to send gift codes
 * to your character, and it can be removed at any time. Nobody else's key can
 * be saved from this form: the database refuses a character that is not yours.
 */
export function GiftKeyForm() {
  const client = useQueryClient();
  const { data, error, isPending } = useQuery({ queryKey: ['my-gift-keys'], queryFn: fetchMyKeys });
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [agreed, setAgreed] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ['my-gift-keys'] });

  const save = useMutation({
    mutationFn: async ({ uid, key }: { uid: number; key: string }) => {
      const { error: rpcError } = await supabase.rpc('save_my_gift_key', {
        p_game_uid: uid,
        p_uuid: key,
      });
      if (rpcError) {
        throw new Error(rpcError.message);
      }
    },
    onSuccess: async (_none, { uid }) => {
      // The pasted text is dropped as soon as it is saved: it is not kept in
      // the page any longer than it has to be.
      setDrafts((now) => ({ ...now, [uid]: '' }));
      setAgreed((now) => ({ ...now, [uid]: false }));
      setProblem(null);
      setNotice('Key saved. Gift codes sent for you will use it.');
      await refresh();
    },
    onError: (e: Error) => {
      setNotice(null);
      setProblem(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (uid: number) => {
      const { error: rpcError } = await supabase.rpc('remove_my_gift_key', { p_game_uid: uid });
      if (rpcError) {
        throw new Error(rpcError.message);
      }
    },
    onSuccess: async () => {
      setProblem(null);
      setNotice('Key removed.');
      await refresh();
    },
    onError: (e: Error) => {
      setNotice(null);
      setProblem(e.message);
    },
  });

  function submit(uid: number) {
    const result = extractGiftKey(drafts[uid] ?? '');
    if (!result.ok) {
      setNotice(null);
      setProblem(pasteProblem(result));
      return;
    }
    save.mutate({ uid, key: result.key });
  }

  return (
    <div className="gift-key">
      <p className="subtle">
        Codes can only be sent to you with a key from your own Gift Center link (the part after{' '}
        <code>uuid=</code>). It is a login token for your Dark War store account, so it is
        write-only: nobody, officers included, can read it back. It is used only to send gift codes
        to your character, and you can remove it at any time.
      </p>

      {isPending && <p className="empty loading">Loading…</p>}
      {error && <p className="error">{error.message}</p>}
      {data !== undefined && data.length === 0 && (
        <p className="empty">No character is linked to this account yet.</p>
      )}
      {notice && <p className="note">{notice}</p>}
      {problem && <p className="error">Not saved: {problem}</p>}

      {data?.map((mine) => (
        <form
          key={mine.game_uid}
          className="migration-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(mine.game_uid);
          }}
        >
          <p>
            <strong>{mine.name}</strong>{' '}
            <span className="muted">
              {mine.has_key
                ? `key saved${mine.updated_at ? ` ${day.format(new Date(mine.updated_at))}` : ''}`
                : 'no key saved'}
            </span>
          </p>
          <label>
            Your Gift Center link, or just the key
            <input
              type="password"
              value={drafts[mine.game_uid] ?? ''}
              onChange={(e) => setDrafts((now) => ({ ...now, [mine.game_uid]: e.target.value }))}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={agreed[mine.game_uid] ?? false}
              onChange={(e) => setAgreed((now) => ({ ...now, [mine.game_uid]: e.target.checked }))}
            />{' '}
            I understand this is a login token and I want it used to send gift codes to {mine.name}.
          </label>
          <button
            type="submit"
            disabled={
              save.isPending || !(agreed[mine.game_uid] ?? false) || !drafts[mine.game_uid]?.trim()
            }
          >
            {mine.has_key ? 'Replace key' : 'Save key'}
          </button>
          {mine.has_key && (
            <button
              type="button"
              className="link"
              disabled={remove.isPending}
              onClick={() => remove.mutate(mine.game_uid)}
            >
              Remove key
            </button>
          )}
        </form>
      ))}
    </div>
  );
}
