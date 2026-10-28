import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { supabase } from '../../lib/supabase';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { TierBadge } from './TierBadge';
import {
  type BoardInfo,
  type Candidate,
  type CandidateColumn,
  type Found,
  type OwnAlliance,
  candidateUid,
  fetchBoardInfo,
  fetchCandidateColumns,
  fetchOwnServerAlliances,
  fetchSavedCandidates,
  foundFor,
  lookupPlayers,
  lookupSeen,
  parseQuery,
  queryOf,
  serverFromUid,
  tierOf,
  unlistedTier,
} from './candidates';
import { num, power } from './format';

const STALE_TIME = 60_000;
const KEY = ['migration', 'candidates-saved'] as const;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

function Coverage({ info }: { info: BoardInfo | null }) {
  if (info === null || info.servers.length === 0) {
    return (
      <p className="empty">
        No state rankings captured yet. Open the Migration tab's state list for each server (top
        150) with the collector running.
      </p>
    );
  }
  return (
    <p className="note">
      Place is among {num(info.listed)} players from {info.servers.length} servers' newest top-150
      lists
      {info.oldest_at && info.newest_at
        ? ` (${serverTime(info.oldest_at)} to ${serverTime(info.newest_at)} server time)`
        : ''}
      .
      {info.missing_servers.length > 0 && (
        <strong>
          {' '}
          Missing: {info.missing_servers.join(', ')}. Everyone below those servers' players is
          placed too high until their lists are captured.
        </strong>
      )}
    </p>
  );
}

function allianceLabel(a: OwnAlliance): string {
  const name = a.current_name ?? '(unnamed)';
  return a.current_code ? `[${a.current_code}] ${name}` : name;
}

/** A text cell that saves when the field is left, and only if it changed. */
function Cell({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (next: string) => void;
}) {
  return (
    <input
      key={value}
      aria-label={label}
      defaultValue={value}
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next !== value) onSave(next);
      }}
    />
  );
}

function Row({
  candidate,
  matches,
  columns,
  alliances,
  anyMigratePower,
  unlisted,
  onPatch,
  onCell,
  onRemove,
}: {
  candidate: Candidate;
  matches: Found[];
  columns: CandidateColumn[];
  alliances: OwnAlliance[];
  anyMigratePower: boolean;
  unlisted: ReturnType<typeof unlistedTier>;
  onPatch: (patch: { game_uid?: number | null; desired_alliance_id?: string | null }) => void;
  onCell: (columnId: string, text: string) => void;
  onRemove: () => void;
}) {
  // The exact place off a state list wins; otherwise the strongest estimate.
  const best = [...matches].sort(
    (a, b) => Number(a.estimated) - Number(b.estimated) || (a.place ?? 1e9) - (b.place ?? 1e9),
  )[0];
  const tierName = best?.place != null ? tierOf(best.place) : best ? null : unlisted;
  const uidServer = serverFromUid(candidateUid(candidate));
  const seenAt = best?.captured_at ? serverTime(best.captured_at) : '';
  return (
    <tr>
      <th scope="row" title={candidate.game_uid === null ? undefined : String(candidate.game_uid)}>
        {best?.name ?? candidate.query}
      </th>
      <td>
        {best === undefined ? (
          uidServer === null ? (
            <span className="subtle" title="Nothing seen of this player yet">
              unknown
            </span>
          ) : (
            <span
              className="subtle"
              title="From the uid: the server this account was made on. Nothing else has been seen of it."
            >
              {uidServer}?
            </span>
          )
        ) : matches.length > 1 ? (
          <Select
            aria-label={`Which ${candidate.query}`}
            title="Several players share this name — pick the one"
            value={best.game_uid}
            onChange={(uid) => onPatch({ game_uid: Number(uid) })}
          >
            {matches.map((m) => (
              <option key={m.game_uid} value={m.game_uid}>
                {m.server_id} · {power(m.power)} · #{m.place ?? '?'}
              </option>
            ))}
          </Select>
        ) : (
          best.server_id
        )}
      </td>
      <td>{best?.alliance_name ?? '—'}</td>
      <td
        className="numeric"
        title={
          best?.power == null ? undefined : `${num(best.power)}${seenAt ? ` · seen ${seenAt}` : ''}`
        }
      >
        {best?.power == null ? '—' : power(best.power)}
      </td>
      {anyMigratePower && (
        <td className="numeric" title={best?.migrate_power_at ?? undefined}>
          {best?.migrate_power == null ? '—' : num(best.migrate_power)}
        </td>
      )}
      <td
        className="numeric"
        title={
          best?.estimated
            ? `Estimated from the power seen ${seenAt}: not on any state list`
            : undefined
        }
      >
        {best?.place == null ? '—' : `${best.estimated ? '~' : ''}${num(best.place)}`}
      </td>
      <td title={best?.estimated ? 'Estimated from the power last seen' : undefined}>
        {tierName ? (
          <>
            {best?.estimated && <span className="subtle">~ </span>}
            <TierBadge tier={tierName} />
          </>
        ) : (
          '—'
        )}
      </td>
      <td>
        <Select
          aria-label={`580 alliance for ${candidate.query}`}
          value={candidate.desired_alliance_id ?? ''}
          onChange={(id) => onPatch({ desired_alliance_id: id === '' ? null : id })}
        >
          <option value="">—</option>
          {alliances.map((a) => (
            <option key={a.alliance_id} value={a.alliance_id}>
              {allianceLabel(a)}
            </option>
          ))}
        </Select>
      </td>
      {columns.map((c) => (
        <td key={c.column_id}>
          <Cell
            label={`${c.label} for ${candidate.query}`}
            value={candidate.extra[c.column_id] ?? ''}
            onSave={(text) => onCell(c.column_id, text)}
          />
        </td>
      ))}
      <td>
        <button type="button" onClick={onRemove} aria-label={`Remove ${candidate.query}`}>
          ×
        </button>
      </td>
    </tr>
  );
}

export function MigrationCandidates() {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [newColumn, setNewColumn] = useState('');

  const saved = useQuery({ queryKey: KEY, queryFn: fetchSavedCandidates, staleTime: STALE_TIME });
  const columns = useQuery({
    queryKey: [...KEY, 'columns'],
    queryFn: fetchCandidateColumns,
    staleTime: STALE_TIME,
  });
  const alliances = useQuery({
    queryKey: [...KEY, 'alliances'],
    queryFn: fetchOwnServerAlliances,
    staleTime: STALE_TIME,
  });
  const info = useQuery({
    queryKey: ['migration', 'board'],
    queryFn: fetchBoardInfo,
    staleTime: STALE_TIME,
  });

  const list = saved.data ?? [];
  const query = queryOf(list);
  const found = useQuery({
    queryKey: ['migration', 'candidates-lookup', query],
    queryFn: () => lookupPlayers(query),
    enabled: query.names.length + query.uids.length > 0,
    staleTime: STALE_TIME,
  });

  const seen = useQuery({
    queryKey: ['migration', 'candidates-seen', query],
    queryFn: () => lookupSeen(query),
    enabled: query.names.length + query.uids.length > 0,
    staleTime: STALE_TIME,
  });

  const refresh = () => client.invalidateQueries({ queryKey: KEY });

  const add = useMutation({
    mutationFn: async () => {
      const known = new Set(list.map((c) => c.query.trim().toLowerCase()));
      const entered = parseQuery(text);
      const rows = [
        ...entered.names.map((query) => ({ query })),
        ...entered.uids.map((uid) => ({ query: String(uid), game_uid: uid })),
      ].filter((r) => !known.has(r.query.toLowerCase()));
      if (rows.length === 0) return;
      const { error } = await supabase.from('migration_candidates').insert(rows);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setText('');
      await refresh();
    },
  });

  const patch = useMutation({
    mutationFn: async (args: {
      id: string;
      values: { game_uid?: number | null; desired_alliance_id?: string | null };
    }) => {
      const { error } = await supabase
        .from('migration_candidates')
        .update(args.values)
        .eq('candidate_id', args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const setCell = useMutation({
    mutationFn: async (args: { candidate: Candidate; columnId: string; text: string }) => {
      const extra = { ...args.candidate.extra, [args.columnId]: args.text };
      const { error } = await supabase
        .from('migration_candidates')
        .update({ extra })
        .eq('candidate_id', args.candidate.candidate_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('migration_candidates').delete().eq('candidate_id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const addColumn = useMutation({
    mutationFn: async () => {
      const label = newColumn.trim();
      if (label === '') return;
      const order = Math.max(0, ...(columns.data ?? []).map((c) => c.sort_order)) + 10;
      const { error } = await supabase
        .from('migration_candidate_columns')
        .insert({ label, sort_order: order });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setNewColumn('');
      await refresh();
    },
  });

  const removeColumn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('migration_candidate_columns')
        .delete()
        .eq('column_id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const rows = found.data ?? [];
  const cols = columns.data ?? [];
  const fallback = unlistedTier(info.data ?? null);
  const seenRows = seen.data ?? [];
  const anyMigratePower =
    rows.some((r) => r.migrate_power !== null) || seenRows.some((r) => r.migrate_power !== null);
  const failure = [
    saved.error,
    columns.error,
    alliances.error,
    info.error,
    found.error,
    seen.error,
    add.error,
    patch.error,
    setCell.error,
    remove.error,
    addColumn.error,
    removeColumn.error,
  ].find((e) => e);

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <label>
          Add candidates — one name (or uid) per line, e.g. pasted from the sheet
          <textarea
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'Name one\nName two\n1343375089000584'}
          />
        </label>
        <button type="submit" disabled={add.isPending || text.trim() === ''}>
          Add
        </button>
      </form>

      <form
        className="migration-bar"
        onSubmit={(event) => {
          event.preventDefault();
          addColumn.mutate();
        }}
      >
        <label>
          New column{' '}
          <input value={newColumn} onChange={(event) => setNewColumn(event.target.value)} />
        </label>
        <button type="submit" disabled={addColumn.isPending || newColumn.trim() === ''}>
          Add column
        </button>
      </form>

      {failure && <p className="error">{failure.message}</p>}
      {!info.isPending && <Coverage info={info.data ?? null} />}
      {(saved.isPending || found.isFetching || seen.isFetching) && (
        <p className="empty loading">Loading…</p>
      )}

      {saved.data && list.length === 0 && <p className="empty">No candidates yet.</p>}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <caption>
              Tier by place across servers 567–588, by power. Server, power and tier follow the
              newest captures; the rest is yours.
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Server</th>
                <th scope="col">Alliance now</th>
                <th scope="col" className="numeric">
                  Power
                </th>
                {anyMigratePower && (
                  <th scope="col" className="numeric">
                    Migrate power
                  </th>
                )}
                <th scope="col" className="numeric">
                  Place
                </th>
                <th scope="col">Tier</th>
                <th scope="col">580 alliance</th>
                {cols.map((c) => (
                  <th scope="col" key={c.column_id}>
                    {c.label}{' '}
                    <button
                      type="button"
                      aria-label={`Remove column ${c.label}`}
                      title="Remove this column (the text stays in the database)"
                      onClick={() => {
                        if (window.confirm(`Remove the column “${c.label}” for everyone?`)) {
                          removeColumn.mutate(c.column_id);
                        }
                      }}
                    >
                      ×
                    </button>
                  </th>
                ))}
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <Row
                  key={c.candidate_id}
                  candidate={c}
                  matches={foundFor(c, rows, seenRows)}
                  columns={cols}
                  alliances={alliances.data ?? []}
                  anyMigratePower={anyMigratePower}
                  unlisted={fallback}
                  onPatch={(values) => patch.mutate({ id: c.candidate_id, values })}
                  onCell={(columnId, value) =>
                    setCell.mutate({ candidate: c, columnId, text: value })
                  }
                  onRemove={() => remove.mutate(c.candidate_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Place and tier come from the state lists when the player is on one. A player outside every
        top 150 is placed by the power last seen (marked ~), with the server, name and alliance from
        the same sighting: a profile, a board, or an alliance roster we opened (the same players the
        Cross-Server player ranking lists). The time is in the tooltip. A server with a question
        mark comes from the uid alone: nothing else has been seen of that player. Opening their
        profile or their alliance's roster in the game fills the rest in. Where every server is
        captured and nothing is known of the player, the tier shows as Backbone, which a misspelt
        name will also get.
      </p>
    </>
  );
}
