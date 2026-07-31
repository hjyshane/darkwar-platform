import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Exchange an invitation code for a role.
 *
 * The grant happens in redeem_join_code(), a security-definer function —
 * the join_codes table is not readable by clients at all, so this form
 * cannot check a code before submitting it and does not try to. Whatever
 * the server says is the answer.
 *
 * Errors are shown verbatim because the function was written to say the
 * same thing for every failure ("that code is not valid"), whether the code
 * is wrong, expired, revoked or used up. Paraphrasing here would risk
 * inventing a distinction the database deliberately refuses to make.
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
      setFailed(true);
      setMessage(error.message);
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
