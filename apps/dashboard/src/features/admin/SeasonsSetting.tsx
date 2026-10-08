import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  type Season,
  deleteSeasonBuilding,
  fetchUnnamedBuildings,
  fromUtcInput,
  nameUnnamedBuildings,
  saveSeason,
  saveSeasonBuilding,
  toUtcInput,
  useSeasons,
} from '../../lib/seasons';

/** Seasons and the buildings each one has.
 *
 * When a new season starts: add it here with its start (game time, UTC), sweep
 * the map as usual, and the building ids the sweeps meet appear under "Seen,
 * not named". The server sends only ids, but the client's own data names most of
 * them (0246): one button names those, and a person names the rest. Then the
 * season behaves like Season 2 and 3 do.
 *
 * The current season is the latest whose start has passed, so a season added
 * with a future start changes nothing until that day. Shared by every alliance.
 */
export function SeasonsSetting() {
  const queryClient = useQueryClient();
  const seasons = useSeasons();
  const unnamed = useQuery({ queryKey: ['seasons-unnamed'], queryFn: fetchUnnamedBuildings });
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const done = () => {
    setFailed(false);
    setMessage('Saved.');
    queryClient.invalidateQueries({ queryKey: ['seasons'] });
    queryClient.invalidateQueries({ queryKey: ['seasons-unnamed'] });
    queryClient.invalidateQueries({ queryKey: ['seasonBoard'] });
    queryClient.invalidateQueries({ queryKey: ['participation'] });
  };
  const fail = (error: Error) => {
    setFailed(true);
    setMessage(`Could not save: ${error.message}`);
  };

  const saveSeasonMutation = useMutation({
    mutationFn: saveSeason,
    onSuccess: done,
    onError: fail,
  });
  const saveBuilding = useMutation({
    mutationFn: saveSeasonBuilding,
    onSuccess: done,
    onError: fail,
  });
  const nameAll = useMutation({
    mutationFn: nameUnnamedBuildings,
    onSuccess: (count) => {
      done();
      setMessage(count === 0 ? 'Nothing to name.' : `Named ${count} from the game's data.`);
    },
    onError: fail,
  });
  const removeBuilding = useMutation({
    mutationFn: (entry: { seasonId: number; typeId: number }) =>
      deleteSeasonBuilding(entry.seasonId, entry.typeId),
    onSuccess: done,
    onError: fail,
  });

  if (seasons.isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (seasons.error) {
    return <p className="error">Could not load the seasons: {(seasons.error as Error).message}</p>;
  }

  const list = [...(seasons.data ?? [])].sort((a, b) => b.id - a.id);
  const picked = list.find((season) => season.id === pickedId) ?? list[0] ?? null;
  const nextNumber = list.reduce((top, season) => Math.max(top, season.id), 0) + 1;
  const busy =
    saveSeasonMutation.isPending ||
    saveBuilding.isPending ||
    removeBuilding.isPending ||
    nameAll.isPending;

  return (
    <div className="setting">
      <p className="note">
        A season is a number, a name and the game day it starts (UTC). The <strong>current</strong>{' '}
        season is the latest one that has started, so adding the next one with a future start
        changes nothing until that day. Duel rounds count from the current season&apos;s start. The
        game sends building <em>ids</em>, not names: sweep the map, then name what turns up under
        “Seen, not named”. Shared by every alliance.
      </p>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <h3>Seasons</h3>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="num" scope="col">
                #
              </th>
              <th className="label" scope="col">
                Name
              </th>
              <th scope="col">Starts (UTC)</th>
              <th scope="col">Ends (UTC)</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {list.map((season) => (
              <SeasonRow
                busy={busy}
                key={season.id}
                onSave={(entry) => saveSeasonMutation.mutate(entry)}
                season={season}
              />
            ))}
          </tbody>
        </table>
      </div>
      <NewSeason
        busy={busy}
        nextNumber={nextNumber}
        onAdd={(entry) => {
          saveSeasonMutation.mutate(entry, { onSuccess: () => setPickedId(entry.id) });
        }}
      />

      <h3>Buildings</h3>
      {picked !== null && (
        <>
          <label htmlFor="season-pick">
            Season{' '}
            <Select
              id="season-pick"
              onChange={(chosen) => setPickedId(Number(chosen))}
              value={picked.id}
            >
              {list.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </Select>
          </label>

          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="num" scope="col">
                    Type id
                  </th>
                  <th className="label" scope="col">
                    Name
                  </th>
                  <th className="num" scope="col">
                    Order
                  </th>
                  <th scope="col">Guess</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {picked.buildings.map((building, index) => (
                  <BuildingRow
                    busy={busy}
                    building={building}
                    // Keyed by what is stored, so a save (which changes the name,
                    // order or guess) hands the row fresh state instead of keeping
                    // the text that was typed.
                    key={`${picked.id}-${building.id}-${building.name}-${building.provisional === true}-${index}`}
                    onDelete={() =>
                      removeBuilding.mutate({ seasonId: picked.id, typeId: building.id })
                    }
                    onSave={(entry) =>
                      saveBuilding.mutate({
                        seasonId: picked.id,
                        typeId: building.id,
                        ...entry,
                      })
                    }
                    order={(index + 1) * 10}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {picked.buildings.length === 0 && (
            <p className="empty">No buildings named for {picked.name} yet.</p>
          )}

          <h4>Seen, not named</h4>
          {unnamed.isPending && <p className="empty loading">Loading…</p>}
          {unnamed.data && unnamed.data.length === 0 && (
            <p className="empty">
              Every building type the sweeps have seen is named in some season.
            </p>
          )}
          {unnamed.data && unnamed.data.some((entry) => entry.gameName !== null) && (
            <p>
              <button disabled={busy} onClick={() => nameAll.mutate(picked.id)} type="button">
                Name {unnamed.data.filter((entry) => entry.gameName !== null).length} with the
                game's names
              </button>{' '}
              <span className="subtle">
                The client's own data names these types; the rest need a person.
              </span>
            </p>
          )}
          {unnamed.data && unnamed.data.length > 0 && (
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th className="num" scope="col">
                      Type id
                    </th>
                    <th className="num" scope="col">
                      Players
                    </th>
                    <th scope="col">Name it for {picked.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {unnamed.data.map((entry) => (
                    <UnnamedRow
                      busy={busy}
                      entry={entry}
                      key={entry.typeId}
                      onName={(name) =>
                        saveBuilding.mutate({ seasonId: picked.id, typeId: entry.typeId, name })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ManualBuilding
            busy={busy}
            onAdd={(typeId, name) => saveBuilding.mutate({ seasonId: picked.id, typeId, name })}
          />
        </>
      )}
    </div>
  );
}

function SeasonRow({
  season,
  busy,
  onSave,
}: {
  season: Season;
  busy: boolean;
  onSave: (entry: {
    id: number;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
}) {
  const [name, setName] = useState(season.name);
  const [starts, setStarts] = useState(toUtcInput(season.startsAt));
  const [ends, setEnds] = useState(toUtcInput(season.endsAt));
  const startsAt = fromUtcInput(starts);
  const endsAt = fromUtcInput(ends);
  const valid = name.trim() !== '' && startsAt !== undefined && endsAt !== undefined;
  const dirty =
    name.trim() !== season.name ||
    starts !== toUtcInput(season.startsAt) ||
    ends !== toUtcInput(season.endsAt);
  return (
    <tr>
      <td className="num">{season.id}</td>
      <td className="label">
        <input
          aria-label={`Name of season ${season.id}`}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          type="text"
          value={name}
        />
      </td>
      <td>
        <input
          aria-label={`Start of season ${season.id}`}
          onChange={(event) => setStarts(event.target.value)}
          type="datetime-local"
          value={starts}
        />
      </td>
      <td>
        <input
          aria-label={`End of season ${season.id}`}
          onChange={(event) => setEnds(event.target.value)}
          type="datetime-local"
          value={ends}
        />
      </td>
      <td>
        <button
          disabled={busy || !valid || !dirty}
          onClick={() =>
            onSave({
              id: season.id,
              name: name.trim(),
              startsAt: startsAt ?? null,
              endsAt: endsAt ?? null,
            })
          }
          type="button"
        >
          Save
        </button>
      </td>
    </tr>
  );
}

function NewSeason({
  nextNumber,
  busy,
  onAdd,
}: {
  nextNumber: number;
  busy: boolean;
  onAdd: (entry: {
    id: number;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [starts, setStarts] = useState('');
  const startsAt = fromUtcInput(starts);
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '' || startsAt === undefined) return;
        onAdd({ id: nextNumber, name: name.trim(), startsAt: startsAt, endsAt: null });
        setName('');
        setStarts('');
      }}
    >
      <label htmlFor="new-season-name">
        New season (number {nextNumber})
        <input
          id="new-season-name"
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          placeholder={`Season ${nextNumber}`}
          type="text"
          value={name}
        />
      </label>
      <label htmlFor="new-season-start">
        Starts (UTC)
        <input
          id="new-season-start"
          onChange={(event) => setStarts(event.target.value)}
          type="datetime-local"
          value={starts}
        />
      </label>
      <button
        className="primary"
        disabled={busy || name.trim() === '' || startsAt === undefined}
        type="submit"
      >
        Add season
      </button>
    </form>
  );
}

function BuildingRow({
  building,
  order,
  busy,
  onSave,
  onDelete,
}: {
  building: { id: number; name: string; provisional?: boolean };
  order: number;
  busy: boolean;
  onSave: (entry: { name: string; sortOrder?: number; provisional: boolean }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(building.name);
  const [guess, setGuess] = useState(building.provisional === true);
  const [position, setPosition] = useState(String(order));
  const parsed = Number.parseInt(position, 10);
  const dirty =
    name.trim() !== building.name ||
    guess !== (building.provisional === true) ||
    (Number.isFinite(parsed) && parsed !== order);
  return (
    <tr>
      <td className="num">{building.id}</td>
      <td className="label">
        <input
          aria-label={`Name of building ${building.id}`}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          type="text"
          value={name}
        />
      </td>
      <td className="num">
        <input
          aria-label={`Order of building ${building.id}`}
          inputMode="numeric"
          onChange={(event) => setPosition(event.target.value)}
          type="number"
          value={position}
        />
      </td>
      <td>
        <input
          aria-label={`Name of ${building.id} is a guess`}
          checked={guess}
          onChange={(event) => setGuess(event.target.checked)}
          type="checkbox"
        />
      </td>
      <td>
        <span className="actions">
          <button
            disabled={busy || !dirty || name.trim() === ''}
            onClick={() =>
              onSave({
                name: name.trim(),
                // Only when the position was edited: the number shown is the
                // building's place in the list, not its stored order, and
                // writing it back would renumber a row nobody moved.
                ...(Number.isFinite(parsed) && parsed !== order ? { sortOrder: parsed } : {}),
                provisional: guess,
              })
            }
            type="button"
          >
            Save
          </button>
          <button disabled={busy} onClick={onDelete} type="button">
            Remove
          </button>
        </span>
      </td>
    </tr>
  );
}

function UnnamedRow({
  entry,
  busy,
  onName,
}: {
  entry: { typeId: number; players: number; gameName: string | null };
  busy: boolean;
  onName: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <tr>
      <td className="num">{entry.typeId}</td>
      <td className="num">{entry.players}</td>
      <td>
        <span className="actions">
          <input
            aria-label={`Name for building ${entry.typeId}`}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={entry.gameName ?? 'name it'}
            type="text"
            value={name}
          />
          {entry.gameName !== null && name.trim() === '' && (
            <button disabled={busy} onClick={() => onName(entry.gameName ?? '')} type="button">
              Use “{entry.gameName}”
            </button>
          )}
          <button
            disabled={busy || name.trim() === ''}
            onClick={() => onName(name.trim())}
            type="button"
          >
            Name
          </button>
        </span>
      </td>
    </tr>
  );
}

function ManualBuilding({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (typeId: number, name: string) => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const id = Number.parseInt(typeId, 10);
  const valid = Number.isFinite(id) && id > 0 && name.trim() !== '';
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onAdd(id, name.trim());
        setTypeId('');
        setName('');
      }}
    >
      <label htmlFor="manual-building-id">
        Add by id
        <input
          id="manual-building-id"
          inputMode="numeric"
          onChange={(event) => setTypeId(event.target.value)}
          placeholder="e.g. 868000"
          type="number"
          value={typeId}
        />
      </label>
      <label htmlFor="manual-building-name">
        Name
        <input
          id="manual-building-name"
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          type="text"
          value={name}
        />
      </label>
      <button disabled={busy || !valid} type="submit">
        Add building
      </button>
    </form>
  );
}
