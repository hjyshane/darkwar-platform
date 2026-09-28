import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface JoinableAlliance {
  alliance_id: string;
  name: string;
  code: string;
  server_id: number;
}

/** Which of our alliances a new account is asking to join.
 *
 * Stored in the account's own auth metadata: it is a request, not a grant, so
 * the client writing it is fine. 0193's `pending_access` reads it, which is how
 * an officer sees the people waiting for THEIR alliance and not the other's.
 *
 * Asked after sign-in rather than on the sign-up form because the list comes
 * from `joinable_alliances()`, and 0168 keeps anon holding nothing — an
 * account that has just signed up is the first moment it can be asked.
 *
 * Renders nothing when there is no choice to make (one own alliance).
 */
export function AllianceRequestForm() {
  const { data: alliances } = useQuery({
    queryKey: ['joinable-alliances'],
    queryFn: async (): Promise<JoinableAlliance[]> => {
      const { data, error } = await supabase.rpc('joinable_alliances');
      if (error) {
        throw new Error(`alliance list failed: ${error.message}`);
      }
      return data ?? [];
    },
  });
  const [chosen, setChosen] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const current = data.user?.user_metadata?.alliance_id;
      if (typeof current === 'string') {
        setChosen(current);
        setSaved(current);
      }
    });
  }, []);

  if (alliances === undefined || alliances.length < 2) {
    return null;
  }

  async function save(allianceId: string) {
    setChosen(allianceId);
    setError(null);
    const { error: failure } = await supabase.auth.updateUser({
      data: { alliance_id: allianceId },
    });
    if (failure) {
      setError(failure.message);
      return;
    }
    setSaved(allianceId);
  }

  const savedName = alliances.find((a) => a.alliance_id === saved);

  return (
    <div>
      <h3>Which alliance are you joining?</h3>
      <label>
        Alliance
        <select onChange={(event) => void save(event.target.value)} value={chosen}>
          <option value="">Choose…</option>
          {alliances.map((alliance) => (
            <option key={alliance.alliance_id} value={alliance.alliance_id}>
              {alliance.name} [{alliance.code}] · {alliance.server_id}
            </option>
          ))}
        </select>
      </label>
      {savedName && (
        <p className="empty">
          Waiting for an officer of <strong>{savedName.code}</strong> to let you in — or enter their
          invitation code below.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
