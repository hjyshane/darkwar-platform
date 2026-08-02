import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type Pet, fetchPets } from '../../lib/heroes';
import { supabase } from '../../lib/supabase';

/** The pet catalogue. Smaller than the hero one and the same idea.
 *
 * Seven rows, and the reason they are rows: the names and — more to the
 * point — their ORDER came from the user with a hedge on it ("아마 순서대로").
 * Only two pet ids have ever been captured, so nothing here can check the
 * other five. A rotated list is the failure mode: every name wrong together,
 * which reads like data rather than like a typo. Being editable from this
 * page is what makes that recoverable in one sitting.
 */
async function fetchPetList(): Promise<Pet[]> {
  return [...(await fetchPets()).values()].sort((left, right) => left.pet_id - right.pet_id);
}

export function PetsSetting() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', notes: '' });
  const [newId, setNewId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({ queryKey: ['pets-admin'], queryFn: fetchPetList });

  const report = (ok: boolean, text: string) => {
    setFailed(!ok);
    setMessage(text);
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['pets-admin'] });
    void queryClient.invalidateQueries({ queryKey: ['pets'] });
  };

  const save = useMutation({
    mutationFn: async ({ petId, values }: { petId: number; values: typeof draft }) => {
      const name = values.name.trim();
      const { error: updateError, count } = await supabase
        .from('pets')
        .update({ name: name === '' ? null : name, notes: values.notes.trim() }, { count: 'exact' })
        .eq('pet_id', petId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      // RLS filters a refused UPDATE to zero rows and reports success, so
      // without this the form says "Saved" to someone whose change went
      // nowhere. Same check the hero form makes.
      if (count === 0) {
        throw new Error('Nothing was written. Naming a pet needs an admin.');
      }
    },
    onSuccess: () => {
      setEditing(null);
      report(true, 'Saved.');
      refresh();
    },
    onError: (mutationError: Error) => report(false, mutationError.message),
  });

  const add = useMutation({
    mutationFn: async (petId: number) => {
      const { error: insertError } = await supabase.from('pets').insert({ pet_id: petId });
      if (insertError) {
        throw new Error(insertError.message);
      }
    },
    onSuccess: (_result, petId) => {
      setNewId('');
      report(true, `Added ${petId}. Give it a name.`);
      refresh();
    },
    onError: (mutationError: Error) => report(false, mutationError.message),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the catalogue: {error.message}</p>;
  }

  const pets = data ?? [];
  return (
    <>
      <p className="subtle">
        The cross-server board ranks a player's strongest pet and the protocol names it with a
        number, same as it does heroes. These names were read off the game; only 105 and 106 have
        ever appeared in a capture, so the rest cannot be checked here — if the order is wrong it
        will be wrong for all of them at once.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Id</th>
              <th className="label">Name</th>
              <th className="label">Notes</th>
              <th className="num" />
            </tr>
          </thead>
          <tbody>
            {pets.map((pet) =>
              editing === pet.pet_id ? (
                <tr key={pet.pet_id}>
                  <td className="num">{pet.pet_id}</td>
                  <td className="label">
                    <input
                      aria-label={`Name for pet ${pet.pet_id}`}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      value={draft.name}
                    />
                  </td>
                  <td className="label">
                    <input
                      aria-label={`Notes for pet ${pet.pet_id}`}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      value={draft.notes}
                    />
                  </td>
                  <td className="num">
                    <button
                      className="linklike"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ petId: pet.pet_id, values: draft })}
                      type="button"
                    >
                      save
                    </button>{' '}
                    <button className="linklike" onClick={() => setEditing(null)} type="button">
                      cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={pet.pet_id}>
                  <td className="num">{pet.pet_id}</td>
                  <td className="label">
                    {pet.name ?? <span className="subtle">not named yet</span>}
                  </td>
                  <td className="label">{pet.notes}</td>
                  <td className="num">
                    <button
                      className="linklike"
                      onClick={() => {
                        setEditing(pet.pet_id);
                        setDraft({ name: pet.name ?? '', notes: pet.notes });
                      }}
                      type="button"
                    >
                      edit
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(newId.trim());
          if (!Number.isInteger(parsed) || parsed <= 0) {
            report(false, 'A pet id is a whole number.');
            return;
          }
          add.mutate(parsed);
        }}
      >
        <input
          aria-label="New pet id"
          inputMode="numeric"
          onChange={(event) => setNewId(event.target.value)}
          placeholder="e.g. 108"
          value={newId}
        />{' '}
        <button disabled={add.isPending} type="submit">
          Add pet
        </button>
      </form>
    </>
  );
}
