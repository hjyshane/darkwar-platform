import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { codeState, generateJoinCode, usesLeft } from '../../lib/joinCode';
import { supabase } from '../../lib/supabase';

/** Invitations. An admin makes a code, a member redeems it at #/login.
 *
 * Until now this table had no screen at all: issuing a code meant an INSERT
 * in psql, which is fine for the first admin and useless for admitting
 * ninety people. MembersSetting says plainly that it edits existing rows
 * and invites nobody — this is the missing half.
 *
 * The code is generated in the browser from crypto.getRandomValues, not on
 * the server. There is nothing to hide from an admin, who is about to read
 * the value out anyway, and the alternative is a function whose only job is
 * to be a random number generator behind a network call.
 *
 * Roles offered stop at officer. redeem_join_code() refuses anything more
 * and a check constraint refuses it again (0021), so admin is not withheld
 * here as a courtesy — it is genuinely not grantable this way, and offering
 * it would be offering a button that always fails.
 *
 * Not gated on the role. RLS is the boundary; a non-admin's insert is
 * refused by the policy and this reports what the database said, the same
 * line OwnAllianceSetting and the month-cards page take.
 */
interface CodeRow {
  code_id: string;
  code: string;
  grants_role: 'member' | 'officer';
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  note: string | null;
  revoked_at: string | null;
  created_at: string;
}

async function fetchCodes(): Promise<CodeRow[]> {
  const { data, error } = await supabase
    .from('join_codes')
    .select(
      'code_id, code, grants_role, max_uses, used_count, expires_at, note, revoked_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(error.message);
  }
  // grants_role is the full app_role enum in the generated types; the check
  // constraint narrows it to these two, so the cast states what the database
  // already guarantees.
  return data as CodeRow[];
}

const DAY_MS = 86_400_000;

export function JoinCodesSetting() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery({ queryKey: ['join-codes'], queryFn: fetchCodes });

  const [role, setRole] = useState<'member' | 'officer'>('member');
  const [maxUses, setMaxUses] = useState('');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['join-codes'] });

  const issue = useMutation({
    mutationFn: async () => {
      const code = generateJoinCode();
      const expiryDays = Number(days);
      const { error: insertError } = await supabase.from('join_codes').insert({
        code,
        grants_role: role,
        max_uses: maxUses.trim() === '' ? null : Number(maxUses),
        // Blank means no expiry. An invitation that never lapses is a
        // reasonable thing to want and a bad default, so the field starts
        // at 30 days rather than empty.
        expires_at:
          days.trim() === '' || expiryDays <= 0
            ? null
            : new Date(Date.now() + expiryDays * DAY_MS).toISOString(),
        note: note.trim() === '' ? null : note.trim(),
      });
      if (insertError) {
        throw new Error(insertError.message);
      }
      return code;
    },
    onSuccess: (code) => {
      setIssued(code);
      setFailure(null);
      setNote('');
      void invalidate();
    },
    onError: (issueError: Error) => {
      setIssued(null);
      setFailure(issueError.message);
    },
  });

  const revoke = useMutation({
    mutationFn: async (codeId: string) => {
      // Revoked, never deleted: used_count is the only record that anyone
      // joined through it, and the row is the only place that lives.
      const { error: updateError } = await supabase
        .from('join_codes')
        .update({ revoked_at: new Date().toISOString() })
        .eq('code_id', codeId);
      if (updateError) {
        throw new Error(updateError.message);
      }
    },
    onSuccess: invalidate,
    onError: (revokeError: Error) => setFailure(revokeError.message),
  });

  const now = new Date();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          issue.mutate();
        }}
      >
        <label>
          Grants
          <select
            onChange={(event) => setRole(event.target.value as 'member' | 'officer')}
            value={role}
          >
            <option value="member">member — sees alliance figures</option>
            <option value="officer">officer — also sees activity and jobs</option>
          </select>
        </label>
        <label>
          Uses (blank for unlimited)
          <input
            inputMode="numeric"
            min="1"
            onChange={(event) => setMaxUses(event.target.value)}
            placeholder="e.g. 100"
            type="number"
            value={maxUses}
          />
        </label>
        <label>
          Expires in days (blank for never)
          <input
            inputMode="numeric"
            min="1"
            onChange={(event) => setDays(event.target.value)}
            type="number"
            value={days}
          />
        </label>
        <label>
          Note (who it went to)
          <input
            onChange={(event) => setNote(event.target.value)}
            placeholder="alliance chat, 2026-08"
            value={note}
          />
        </label>
        <button disabled={issue.isPending} type="submit">
          {issue.isPending ? 'Issuing…' : 'Issue a code'}
        </button>
      </form>

      {issued !== null && (
        <p className="issued">
          Give out <code>{issued}</code> — it is in the table below and can be revoked there.
        </p>
      )}
      {failure !== null && <p className="error">{failure}</p>}

      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load codes: {error.message}</p>}

      {data && data.length === 0 && <p className="empty">No code has been issued yet.</p>}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label" scope="col">
                  Code
                </th>
                <th scope="col">Grants</th>
                <th scope="col">State</th>
                <th className="num" scope="col">
                  Used
                </th>
                <th scope="col">Expires</th>
                <th scope="col">Note</th>
                {/* Named, not blank: an empty header is announced as an
                    empty column, and the reader still has to know what the
                    buttons in it do. */}
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const state = codeState(row, now);
                const left = usesLeft(row);
                return (
                  <tr key={row.code_id}>
                    <td className="label">
                      <code>{row.code}</code>
                    </td>
                    <td>{row.grants_role}</td>
                    <td>
                      <span className={`badge badge-code-${state.replace(' ', '-')}`}>{state}</span>
                    </td>
                    <td className="num">
                      {row.used_count}
                      {left === null ? '' : ` / ${row.used_count + left}`}
                    </td>
                    <td>{row.expires_at === null ? '—' : row.expires_at.slice(0, 10)}</td>
                    <td>{row.note ?? '—'}</td>
                    <td>
                      {state === 'active' && (
                        <button
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(row.code_id)}
                          type="button"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
