import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { isCodeComplete, joinCodeFrom } from '../../lib/joinCode';
import { supabase } from '../../lib/supabase';
import { CodeBoxes } from './JoinCodeForm';
import { fetchChosenAlliance } from './PlayerClaimForm';
import { type CharacterChoice, type JoinOutcome, joinAndClaim } from './joinAndClaim';

export type Joined = Extract<JoinOutcome, { kind: 'joined' }>;

/** The "not in the list" entry of the dropdown. Not a uuid, so it cannot
 * collide with a player id. */
const TYPE_IT = 'type-it';

interface RosterEntry {
  player_id: string;
  name: string;
  game_uid: number;
  alliance_code: string;
}

/** The invitation code and your character, on one form.
 *
 * Shown to a signed-in account with no alliance role yet. The character is a
 * dropdown of our alliances' CURRENT members (0333's join_roster, the one
 * roster a viewer may read), with "not in the list" opening a box for an
 * in-game name or game uid — for somebody who joined after the last roster
 * scan. One button redeems the code, then links the character (see
 * joinAndClaim.ts for why that order is forced). */
export function JoinForm({ onJoined }: { onJoined: (outcome: Joined) => void }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [picked, setPicked] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const { data: chosenAlliance } = useQuery({
    queryKey: ['chosen-alliance'],
    queryFn: fetchChosenAlliance,
  });
  const roster = useQuery({
    queryKey: ['join-roster', chosenAlliance ?? null],
    enabled: chosenAlliance !== undefined,
    queryFn: async (): Promise<RosterEntry[]> => {
      const { data, error } = await supabase.rpc(
        'join_roster',
        chosenAlliance ? { p_alliance: chosenAlliance } : {},
      );
      if (error) throw new Error(`member list failed: ${error.message}`);
      return data ?? [];
    },
  });
  const entries = roster.data ?? [];
  const showCode = new Set(entries.map((e) => e.alliance_code)).size > 1;

  function choice(): CharacterChoice {
    if (picked === TYPE_IT) return { kind: 'typed', text: typed };
    const entry = entries.find((e) => e.player_id === picked);
    return entry === undefined
      ? { kind: 'none' }
      : { kind: 'picked', playerId: entry.player_id, name: entry.name };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);
    const outcome = await joinAndClaim(joinCodeFrom(first, second), choice());
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.message);
      return;
    }
    onJoined(outcome);
  }

  return (
    <form className="join-form" onSubmit={(event) => void submit(event)}>
      <h3>Join your alliance</h3>
      <p className="empty">
        Enter the invitation code an officer gave you and pick your character. Alliance-only pages
        open as soon as the code is accepted.
      </p>
      <CodeBoxes first={first} onFirst={setFirst} onSecond={setSecond} second={second} />
      <label>
        Your character
        <Select onChange={setPicked} value={picked}>
          <option value="">Choose…</option>
          {entries.map((entry) => (
            <option key={entry.player_id} value={entry.player_id}>
              {entry.name}
              {showCode ? ` [${entry.alliance_code}]` : ''}
            </option>
          ))}
          <option value={TYPE_IT}>Not in the list — type it</option>
        </Select>
      </label>
      {roster.error && (
        <p className="error">Could not load the member list; type your name or UID instead.</p>
      )}
      {picked === TYPE_IT && (
        <label>
          In-game name or UID
          <input
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Exactly as in the game, or the number in your profile"
            spellCheck={false}
            value={typed}
          />
        </label>
      )}
      <button disabled={busy || !isCodeComplete(first, second)} type="submit">
        {busy ? 'Joining…' : 'Join'}
      </button>
      {refusal && <p className="error">{refusal}</p>}
    </form>
  );
}
