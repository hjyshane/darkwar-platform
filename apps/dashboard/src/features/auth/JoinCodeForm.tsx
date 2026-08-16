import { useRef, useState } from 'react';
import {
  CODE_GROUP,
  cleanCodePart,
  isCodeComplete,
  joinCodeFrom,
  splitPastedCode,
} from '../../lib/joinCode';
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
  // Two halves rather than one string. The code is dictated and typed by
  // hand, and the hyphen was a character people either forgot or typed twice.
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const secondBox = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('redeem_join_code', {
      p_code: joinCodeFrom(first, second),
    });
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
    setFirst('');
    setSecond('');
    setMessage(`You are now ${data}.`);
    onRedeemed();
  }

  return (
    <form onSubmit={(event) => void redeem(event)}>
      <p className="empty">
        This account has no alliance role yet, so alliance-only figures stay hidden. Enter the
        invitation code an officer gave you.
      </p>
      {/* TWO BOXES AND NO HYPHEN. The separator is printed between them
          instead of typed: it was the one character people got wrong, and a
          wrong character costs an attempt against a five-try lockout (0021).
          Lowercase is folded up — every issued code is uppercase by
          construction, so a lowercase one is a typing choice, not a different
          code. */}
      <fieldset className="code-boxes">
        <legend>Invitation code</legend>
        <input
          aria-label="Invitation code, first half"
          autoComplete="off"
          inputMode="text"
          maxLength={CODE_GROUP}
          onChange={(event) => {
            const [a, b] = splitPastedCode(event.target.value);
            setFirst(a);
            // A pasted whole code fills both, and typing the fifth character
            // moves on rather than making somebody reach for the mouse.
            if (b !== '') {
              setSecond(b);
              secondBox.current?.focus();
            } else if (a.length === CODE_GROUP) {
              secondBox.current?.focus();
            }
          }}
          spellCheck={false}
          value={first}
        />
        <span aria-hidden="true" className="code-dash">
          -
        </span>
        <input
          aria-label="Invitation code, second half"
          autoComplete="off"
          inputMode="text"
          maxLength={CODE_GROUP}
          onChange={(event) => setSecond(cleanCodePart(event.target.value))}
          ref={secondBox}
          spellCheck={false}
          value={second}
        />
      </fieldset>
      <button disabled={busy || !isCodeComplete(first, second)} type="submit">
        {busy ? 'Checking…' : 'Redeem'}
      </button>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </form>
  );
}
