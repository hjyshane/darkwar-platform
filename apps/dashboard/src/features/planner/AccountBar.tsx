// Which account the planner is for, and — for one entered by hand — the
// banner that says so and saves it.
//
// The list is every account with a login or a hand entry the reader can see,
// then "enter by hand" for the characters the reader may type in (their own
// claims; every member with data.enter) that have neither yet.

import { useQuery } from '@tanstack/react-query';
import { type Account, type Enterable, fetchEnterable } from './accounts';

interface AccountBarProps {
  accounts: ReadonlyArray<Account>;
  current: Account | undefined;
  onPick: (playerId: string) => void;
  onStart: (who: Enterable) => void;
}

export function AccountBar({ accounts, current, onPick, onStart }: AccountBarProps) {
  const enterable = useQuery({
    queryKey: ['planner-enterable'],
    queryFn: fetchEnterable,
    staleTime: 10 * 60_000,
  });
  const have = new Set(accounts.map((a) => a.playerId));
  if (current) have.add(current.playerId);
  const fresh = (enterable.data ?? []).filter((e) => !have.has(e.playerId));
  const listed =
    current && !accounts.some((a) => a.playerId === current.playerId)
      ? [...accounts, current]
      : accounts;

  return (
    <div className="row">
      {listed.length > 0 && current && (
        <label>
          Account{' '}
          <select onChange={(e) => onPick(e.target.value)} value={current.playerId}>
            {listed.map((a) => (
              <option key={a.playerId} value={a.playerId}>
                {a.name}
                {a.source === 'manual' ? ' (by hand)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {fresh.length > 0 && (
        <label>
          Enter by hand{' '}
          <select
            onChange={(e) => {
              const who = fresh.find((f) => f.playerId === e.target.value);
              if (who) onStart(who);
            }}
            value=""
          >
            <option value="">Pick a character…</option>
            {fresh.map((f) => (
              <option key={f.playerId} value={f.playerId}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

interface ManualBannerProps {
  account: Account;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}

export function ManualBanner({
  account,
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
}: ManualBannerProps) {
  return (
    <section aria-label="Entered by hand" className="planner-manual">
      <span>
        {account.name}'s levels, buffs and stock are entered by hand
        {account.capturedAt
          ? ` (saved ${account.capturedAt.slice(0, 16).replace('T', ' ')} UTC)`
          : ' and not saved yet'}
        . Type the levels now in each list; a login, once the collector sees one, replaces this.
      </span>
      <span className="row">
        <button disabled={!dirty || saving} onClick={onSave} type="button">
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {dirty && (
          <button disabled={saving} onClick={onDiscard} type="button">
            Discard changes
          </button>
        )}
      </span>
      {error && <span className="error">Could not save: {error}</span>}
    </section>
  );
}
