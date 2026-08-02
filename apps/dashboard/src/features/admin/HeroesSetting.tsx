import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type Hero, fetchHeroes } from '../../lib/heroes';
import { supabase } from '../../lib/supabase';
import { TROOP_CLASSES, troopClassName } from '../../lib/troops';

/** The hero catalogue, typed in rather than captured.
 *
 * This is the one screen on the admin page that is not a setting. It is data
 * entry, and it exists because the game's protocol has no hero names in it:
 * the server sends localisation keys (`"name": "483491"`) and the client
 * resolves them from the APK. Every other name in this dashboard — players,
 * alliances — arrives on the wire. These do not, so somebody types them.
 *
 * Classes arrive already filled for the 24 heroes somebody has fielded in a
 * captured arena lineup, since each hero id carried exactly one class across
 * all 4,260 decoded units. The rest are blank because nobody observed has
 * played them, not because the class is unknowable — read it off the game
 * and put it in.
 *
 * No role gate here, same as the rest of this page: RLS refuses the write
 * and the form repeats what the database said.
 */
async function fetchHeroList(): Promise<Hero[]> {
  return [...(await fetchHeroes()).values()].sort((left, right) => left.hero_id - right.hero_id);
}

interface Draft {
  name: string;
  troop_class: string;
  notes: string;
}

function draftOf(hero: Hero): Draft {
  return {
    name: hero.name ?? '',
    troop_class: hero.troop_class === null ? '' : String(hero.troop_class),
    notes: hero.notes,
  };
}

export function HeroesSetting() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', troop_class: '', notes: '' });
  const [newId, setNewId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['heroes-admin'],
    queryFn: fetchHeroList,
  });

  const report = (ok: boolean, text: string) => {
    setFailed(!ok);
    setMessage(text);
  };

  const save = useMutation({
    mutationFn: async ({ heroId, values }: { heroId: number; values: Draft }) => {
      const name = values.name.trim();
      const troopClass = values.troop_class.trim();
      const { error: updateError, count } = await supabase
        .from('heroes')
        .update(
          {
            // Empty is null, not an empty string: "nobody has typed it yet"
            // is a real state and the column's check constraint refuses
            // whitespace outright.
            name: name === '' ? null : name,
            troop_class: troopClass === '' ? null : Number(troopClass),
            notes: values.notes.trim(),
          },
          { count: 'exact' },
        )
        .eq('hero_id', heroId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      // An UPDATE the policy refuses does not raise — RLS filters it to zero
      // rows and reports success. Without this check the form would say
      // "Saved" to someone whose change went nowhere. 0034's admin form
      // learned the same thing about deletes.
      if (count === 0) {
        throw new Error('Nothing was written. Naming a hero needs an admin.');
      }
    },
    onSuccess: () => {
      setEditing(null);
      report(true, 'Saved.');
      void queryClient.invalidateQueries({ queryKey: ['heroes-admin'] });
      void queryClient.invalidateQueries({ queryKey: ['heroes'] });
    },
    onError: (mutationError: Error) => report(false, mutationError.message),
  });

  const add = useMutation({
    mutationFn: async (heroId: number) => {
      const { error: insertError } = await supabase.from('heroes').insert({ hero_id: heroId });
      if (insertError) {
        throw new Error(insertError.message);
      }
    },
    onSuccess: (_result, heroId) => {
      setNewId('');
      report(true, `Added ${heroId}. Give it a name and a class.`);
      void queryClient.invalidateQueries({ queryKey: ['heroes-admin'] });
      void queryClient.invalidateQueries({ queryKey: ['heroes'] });
    },
    onError: (mutationError: Error) => report(false, mutationError.message),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the catalogue: {error.message}</p>;
  }

  const heroes = data ?? [];
  const unnamed = heroes.filter((hero) => hero.name === null).length;

  return (
    <>
      <p className="subtle">
        Hero names are the one thing the game never sends — the server transmits a localisation key
        and the app looks the text up locally. So they are typed here, once, and the arena board
        shows the id until they are. Classes are already filled in for every hero someone has been
        seen fielding.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {unnamed > 0 && (
        <p className="empty">
          {unnamed} of {heroes.length} still show as a number.
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Id</th>
              <th className="label">Name</th>
              <th className="label">Class</th>
              <th className="label">Notes</th>
              <th className="num" />
            </tr>
          </thead>
          <tbody>
            {heroes.map((hero) =>
              editing === hero.hero_id ? (
                <tr key={hero.hero_id}>
                  <td className="num">{hero.hero_id}</td>
                  <td className="label">
                    <input
                      aria-label={`Name for hero ${hero.hero_id}`}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      value={draft.name}
                    />
                  </td>
                  <td className="label">
                    <select
                      aria-label={`Class for hero ${hero.hero_id}`}
                      onChange={(event) => setDraft({ ...draft, troop_class: event.target.value })}
                      value={draft.troop_class}
                    >
                      <option value="">Unknown</option>
                      {Object.entries(TROOP_CLASSES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="label">
                    <input
                      aria-label={`Notes for hero ${hero.hero_id}`}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      value={draft.notes}
                    />
                  </td>
                  <td className="num">
                    <button
                      className="linklike"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ heroId: hero.hero_id, values: draft })}
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
                <tr key={hero.hero_id}>
                  <td className="num">{hero.hero_id}</td>
                  <td className="label">
                    {hero.name ?? <span className="subtle">not named yet</span>}
                  </td>
                  <td className="label">
                    {hero.troop_class === null ? (
                      <span className="subtle">unknown</span>
                    ) : (
                      troopClassName(hero.troop_class)
                    )}
                  </td>
                  <td className="label">{hero.notes}</td>
                  <td className="num">
                    <button
                      className="linklike"
                      onClick={() => {
                        setEditing(hero.hero_id);
                        setDraft(draftOf(hero));
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

      {/* The reason the catalogue is a table and not a constant in the
          source: a hero ships every season and adding it should not need a
          migration, a review and a deploy. */}
      <p className="subtle">
        A hero released after this list was built goes in here by id — the id is the number the
        arena board shows for anyone fielding it.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(newId.trim());
          if (!Number.isInteger(parsed) || parsed <= 0) {
            report(false, 'A hero id is a whole number.');
            return;
          }
          add.mutate(parsed);
        }}
      >
        <input
          aria-label="New hero id"
          inputMode="numeric"
          onChange={(event) => setNewId(event.target.value)}
          placeholder="e.g. 33006"
          value={newId}
        />{' '}
        <button disabled={add.isPending} type="submit">
          Add hero
        </button>
      </form>
    </>
  );
}
