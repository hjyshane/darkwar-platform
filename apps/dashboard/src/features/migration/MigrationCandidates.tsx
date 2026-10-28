import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { supabase } from '../../lib/supabase';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { CandidateColumnCell } from './CandidateColumnCell';
import { CandidateColumnsManager, type ColumnDraft } from './CandidateColumnsManager';
import { TierBadge } from './TierBadge';
import {
  ALL,
  type Filters,
  NONE,
  NO_FILTERS,
  type Sort,
  type ViewRow,
  allianceLabel,
  applyFilters,
  buildRows,
  facets,
  filtersActive,
  nextSort,
  sortRows,
} from './candidateTable';
import {
  type BoardInfo,
  type Candidate,
  type CandidateColumn,
  type OwnAlliance,
  TIERS_TOP_DOWN,
  TIER_LABELS,
  fetchBoardInfo,
  fetchCandidateColumns,
  fetchOwnServerAlliances,
  fetchSavedCandidates,
  foundFor,
  lookupPlayers,
  lookupSeen,
  parseQuery,
  queryOf,
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

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: string;
  sort: Sort | null;
  onSort: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort?.key === sortKey ? sort.direction : null;
  return (
    <th
      scope="col"
      className={numeric ? 'numeric' : undefined}
      aria-sort={active === null ? 'none' : active === 'asc' ? 'ascending' : 'descending'}
    >
      <button type="button" onClick={() => onSort(sortKey)} title="Sort by this column">
        {label}
        {active === 'asc' ? ' ▲' : active === 'desc' ? ' ▼' : ''}
      </button>
    </th>
  );
}

function Row({
  view,
  columns,
  alliances,
  anyMigratePower,
  onPatch,
  onCell,
  onRemove,
}: {
  view: ViewRow;
  columns: CandidateColumn[];
  alliances: OwnAlliance[];
  anyMigratePower: boolean;
  onPatch: (patch: { game_uid?: number | null; desired_alliance_id?: string | null }) => void;
  onCell: (columnId: string, text: string) => void;
  onRemove: () => void;
}) {
  const { candidate, best, found: matches, tier, server, serverGuessed } = view;
  const seenAt = best?.captured_at ? serverTime(best.captured_at) : '';
  return (
    <tr>
      <th scope="row" title={candidate.game_uid === null ? undefined : String(candidate.game_uid)}>
        {best?.name ?? candidate.query}
      </th>
      <td>
        {best === undefined ? (
          server === null ? (
            <span className="subtle" title="Nothing seen of this player yet">
              unknown
            </span>
          ) : (
            <span
              className="subtle"
              title="From the uid: the server this account was made on. Nothing else has been seen of it."
            >
              {server}
              {serverGuessed ? '?' : ''}
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
        {tier ? (
          <>
            {best?.estimated && <span className="subtle">~ </span>}
            <TierBadge tier={tier} />
          </>
        ) : (
          '—'
        )}
      </td>
      <td title={best?.source ? `From the ${best.source}` : undefined}>
        {best?.captured_at ? (
          <>
            {serverTime(best.captured_at)}
            {best.source && <span className="subtle"> · {best.source}</span>}
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
          <CandidateColumnCell
            column={c}
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

/** Narrow the table by search text, server, the alliance they are in now, the 580
 * alliance they want, or tier. `NONE` keeps rows with nothing in that field. */
function FilterBar({
  filters,
  onChange,
  servers,
  alliancesNow,
  alliances,
  shown,
  total,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  servers: number[];
  alliancesNow: string[];
  alliances: OwnAlliance[];
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="migration-bar">
      <label>
        Find{' '}
        <input
          value={filters.search}
          onChange={(event) => set({ search: event.target.value })}
          placeholder="name or uid"
        />
      </label>
      <label>
        Server{' '}
        <Select value={filters.server} onChange={(server) => set({ server })}>
          <option value={ALL}>All</option>
          {servers.map((s) => (
            <option key={s} value={String(s)}>
              {s}
            </option>
          ))}
          <option value={NONE}>Unknown</option>
        </Select>
      </label>
      <label>
        Alliance now{' '}
        <Select value={filters.allianceNow} onChange={(allianceNow) => set({ allianceNow })}>
          <option value={ALL}>All</option>
          {alliancesNow.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NONE}>Unknown</option>
        </Select>
      </label>
      <label>
        580 alliance{' '}
        <Select value={filters.desired} onChange={(desired) => set({ desired })}>
          <option value={ALL}>All</option>
          {alliances.map((a) => (
            <option key={a.alliance_id} value={a.alliance_id}>
              {allianceLabel(a)}
            </option>
          ))}
          <option value={NONE}>Not chosen</option>
        </Select>
      </label>
      <label>
        Tier{' '}
        <Select value={filters.tier} onChange={(tier) => set({ tier })}>
          <option value={ALL}>All</option>
          {TIERS_TOP_DOWN.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
          <option value={NONE}>Unknown</option>
        </Select>
      </label>
      {filtersActive(filters) && (
        <button type="button" onClick={() => onChange(NO_FILTERS)}>
          Clear
        </button>
      )}
      <span className="subtle">
        {shown === total ? `${num(total)} candidates` : `${num(shown)} of ${num(total)}`}
      </span>
    </div>
  );
}

export function MigrationCandidates() {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort | null>(null);

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
    mutationFn: async (draft: ColumnDraft) => {
      const order = Math.max(0, ...(columns.data ?? []).map((c) => c.sort_order)) + 10;
      const { error } = await supabase.from('migration_candidate_columns').insert({
        label: draft.label,
        kind: draft.kind,
        options: draft.options,
        sort_order: order,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  const updateColumn = useMutation({
    mutationFn: async (args: { id: string; label: string; options: string[] }) => {
      const { error } = await supabase
        .from('migration_candidate_columns')
        .update({ label: args.label, options: args.options })
        .eq('column_id', args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
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
  const ownAlliances = alliances.data ?? [];
  const allRows = buildRows(
    list,
    (c) => foundFor(c, rows, seen.data ?? []),
    ownAlliances,
    fallback,
  );
  const shownRows = sortRows(applyFilters(allRows, filters), sort, cols);
  const choices = facets(allRows);
  const onSort = (key: string) => setSort((current) => nextSort(current, key));
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
    updateColumn.error,
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

      <CandidateColumnsManager
        columns={cols}
        pending={addColumn.isPending || updateColumn.isPending}
        onAdd={(draft) => addColumn.mutate(draft)}
        onUpdate={(id, draft) => updateColumn.mutate({ id, ...draft })}
        onRemove={(column) => {
          if (window.confirm(`Remove the column “${column.label}” for everyone?`)) {
            removeColumn.mutate(column.column_id);
          }
        }}
      />

      {failure && <p className="error">{failure.message}</p>}
      {!info.isPending && <Coverage info={info.data ?? null} />}
      {(saved.isPending || found.isFetching || seen.isFetching) && (
        <p className="empty loading">Loading…</p>
      )}

      {saved.data && list.length === 0 && <p className="empty">No candidates yet.</p>}
      {list.length > 0 && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          servers={choices.servers}
          alliancesNow={choices.alliancesNow}
          alliances={ownAlliances}
          shown={shownRows.length}
          total={allRows.length}
        />
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <caption>
              Tier by place across servers 567–588, by power. Server, power and tier follow the
              newest captures; the rest is yours.
            </caption>
            <thead>
              <tr>
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
                <SortHeader label="Server" sortKey="server" sort={sort} onSort={onSort} />
                <SortHeader
                  label="Alliance now"
                  sortKey="allianceNow"
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader label="Power" sortKey="power" sort={sort} onSort={onSort} numeric />
                {anyMigratePower && (
                  <SortHeader
                    label="Migrate power"
                    sortKey="migratePower"
                    sort={sort}
                    onSort={onSort}
                    numeric
                  />
                )}
                <SortHeader label="Place" sortKey="place" sort={sort} onSort={onSort} numeric />
                <SortHeader label="Tier" sortKey="tier" sort={sort} onSort={onSort} />
                <SortHeader label="Read" sortKey="read" sort={sort} onSort={onSort} />
                <SortHeader label="580 alliance" sortKey="desired" sort={sort} onSort={onSort} />
                {cols.map((c) => (
                  <SortHeader
                    key={c.column_id}
                    label={c.label}
                    sortKey={`col:${c.column_id}`}
                    sort={sort}
                    onSort={onSort}
                    numeric={c.kind === 'number'}
                  />
                ))}
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((view) => (
                <Row
                  key={view.candidate.candidate_id}
                  view={view}
                  columns={cols}
                  alliances={ownAlliances}
                  anyMigratePower={anyMigratePower}
                  onPatch={(values) => patch.mutate({ id: view.candidate.candidate_id, values })}
                  onCell={(columnId, value) =>
                    setCell.mutate({ candidate: view.candidate, columnId, text: value })
                  }
                  onRemove={() => remove.mutate(view.candidate.candidate_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && shownRows.length === 0 && (
        <p className="empty">No candidate matches these filters.</p>
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
