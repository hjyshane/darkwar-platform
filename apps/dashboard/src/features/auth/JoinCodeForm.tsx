import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Exchange an invitation code for a role.
 *
 * The grant happens in redeem_join_code(), a security-definer function —
 * the join_codes table is not readable by clients at all, so this form
 * cannot check a code before submitting it and does not try to. Whatever
 * the server says is the answer.
 *
 * A refused code comes back as null rather than an error — the function
 * returns instead of raising so that the failed attempt it just recorded
 * survives, since raising would roll the counter back with it. So null is
 * the answer for wrong, expired, revoked and exhausted alike, and this form
 * says one thing for all four. Anything more specific would invent a
 * distinction the database deliberately refuses to make.
 *
 * An actual error is the lockout, and that one is shown verbatim.
 */
export function JoinCodeForm({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('redeem_join_code', { p_code: code.trim() });
    setBusy(false);
    if (error) {
      // The only error the function raises is the lockout, and that one is
      // about the caller rather than about which codes exist, so it is safe
      // to pass through as written.
      setFailed(true);
      setMessage(error.message);
      return;
    }
    if (data === null) {
      setFailed(true);
      setMessage('That code is not valid.');
      return;
    }
    setFailed(false);
    setCode('');
    setMessage(`You are now ${data}.`);
    onRedeemed();
  }

  return (
    <form onSubmit={(event) => void redeem(event)}>
      <p className="empty">
        This account has no alliance role yet, so alliance-only figures stay hidden. Enter the
        invitation code an officer gave you.
      </p>
      <label>
        Invitation code
        <input
          autoComplete="off"
          onChange={(event) => setCode(event.target.value)}
          required
          spellCheck={false}
          value={code}
        />
      </label>
      <button disabled={busy || code.trim() === ''} type="submit">
        {busy ? 'Checking…' : 'Redeem'}
      </button>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </form>
  );
}
