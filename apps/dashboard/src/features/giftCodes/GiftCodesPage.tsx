import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { StatTile } from '../../components/StatTile';
import {
  type GiftCode,
  type GiftMember,
  addGiftCode,
  cancelGiftClaims,
  enqueueGiftClaims,
  fetchGiftCodes,
  fetchGiftMembers,
  setGiftCodeStatus,
  setGiftExclusion,
} from './data';
import {
  allSelected,
  byRank,
  claimLabel,
  claimableSelection,
  isLive,
  pickableUids,
  rankGroups,
  rankLabel,
  summarise,
  toggleGroup,
} from './status';
import { giftStrip } from './strip';

const REFRESH_MS = 15_000;

/** Gift codes (0251): the codes an officer keeps, and who each is queued for.
 *
 * A code is redeemed on the game's own web Gift Center with a player's id, and
 * the reward arrives in that player's in-game mail. Pressing a button here only
 * QUEUES pairs; a worker on the collector PC sends them one at a time, slowly.
 * The database decides who may do any of it - this page shows what it said.
 */
export function GiftCodesPage() {
  const client = useQueryClient();
  const codes = useQuery({
    queryKey: ['gift', 'codes'],
    queryFn: fetchGiftCodes,
    refetchInterval: REFRESH_MS,
  });
  const members = useQuery({
    queryKey: ['gift', 'members'],
    queryFn: fetchGiftMembers,
    refetchInterval: REFRESH_MS,
  });
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [newCode, setNewCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ['gift'] });
  const onError = () => setNotice(null);

  const add = useMutation({
    mutationFn: () => addGiftCode(newCode),
    onSuccess: async () => {
      setNewCode('');
      setNotice('Code added. It is not claimed for anyone until you press Claim.');
      await refresh();
    },
    onError,
  });
  const claim = useMutation({
    mutationFn: ({ codeIds, uids }: { codeIds: string[]; uids?: number[] }) =>
      enqueueGiftClaims(codeIds, uids),
    onSuccess: async (queued) => {
      setNotice(
        queued === 0
          ? 'Nothing new to queue: everyone is already waiting or has it.'
          : `Queued ${queued} ${queued === 1 ? 'claim' : 'claims'}. They are sent one at a time.`,
      );
      await refresh();
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (codeId: string) => cancelGiftClaims(codeId),
    onSuccess: async (count) => {
      setNotice(`Cancelled ${count} waiting ${count === 1 ? 'claim' : 'claims'}.`);
      await refresh();
    },
    onError,
  });
  const retire = useMutation({
    mutationFn: (codeId: string) => setGiftCodeStatus(codeId, 'expired'),
    onSuccess: refresh,
    onError,
  });
  const exclude = useMutation({
    mutationFn: ({ uid, excluded }: { uid: number; excluded: boolean }) =>
      setGiftExclusion(uid, excluded),
    onSuccess: refresh,
    onError,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (newCode.trim() !== '') {
      add.mutate();
    }
  }

  const list = codes.data ?? [];
  const live = list.filter(isLive);
  const people = members.data ?? [];
  const claimable = claimableSelection(people, selected);
  const failure = [add, claim, cancel, retire, exclude].find((m) => m.error)?.error;

  const groups = rankGroups(people);
  const everyone = pickableUids(people);

  function toggle(uid: number) {
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }

  return (
    <section aria-labelledby="gift-heading" className="gift-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            GC
          </span>
          <div>
            <h2 id="gift-heading">Gift codes</h2>
            <p className="entity-meta">
              <span>Redeemed on the game's Gift Center</span>
              <span>The reward arrives in each player's in-game mail</span>
            </p>
          </div>
        </header>
        {codes.data && members.data && (
          <div className="strip">
            {giftStrip(list, people).map((cell, index) => (
              <StatTile
                hero={index === 0}
                key={cell.label}
                label={cell.label}
                note={cell.note}
                value={cell.value}
              />
            ))}
          </div>
        )}
        <p className="entity-foot">
          Pressing Claim only queues the requests: a worker on the collector PC sends them one at a
          time, slowly. Everyone on the roster is claimed for unless you leave them out below.
        </p>
      </div>

      <section aria-label="Add a code" className="panel">
        <form className="migration-form" onSubmit={submit}>
          <label>
            Add a code <span className="muted">(letters and digits, case matters)</span>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. DWDC6R4M"
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={add.isPending || newCode.trim() === ''}>
            Add code
          </button>
        </form>
      </section>

      {notice && <p className="note">{notice}</p>}
      {failure && <p className="error">Not done: {failure.message}</p>}

      <section aria-labelledby="gift-codes-heading" className="panel">
        <h2 id="gift-codes-heading">Codes</h2>
        {codes.isPending && <p className="empty loading">Loading…</p>}
        {codes.error && <p className="error">{codes.error.message}</p>}
        {codes.data && list.length === 0 && (
          <p className="empty">No codes yet. Add the first one above.</p>
        )}

        {list.length > 0 && (
          <div className="table-wrap">
            <table className="compact">
              <caption className="visually-hidden">Codes</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="numeric">
                    Received
                  </th>
                  <th scope="col" className="numeric">
                    Waiting
                  </th>
                  <th scope="col" className="numeric">
                    Failed
                  </th>
                  <th scope="col" className="numeric">
                    Not asked
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <CodeRow
                    key={c.code_id}
                    code={c}
                    busy={claim.isPending || cancel.isPending || retire.isPending}
                    onClaim={() => claim.mutate({ codeIds: [c.code_id] })}
                    onCancel={() => cancel.mutate(c.code_id)}
                    onRetire={() => retire.mutate(c.code_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="gift-members-heading" className="panel">
        <h2 id="gift-members-heading">
          Members <span className="subtle">who has what</span>
        </h2>
        {members.isPending && <p className="empty loading">Loading…</p>}
        {members.error && <p className="error">{members.error.message}</p>}
        {members.data && people.length === 0 && (
          <p className="empty">No roster has been read for this alliance yet.</p>
        )}

        {people.length > 0 && (
          <>
            <div className="migration-bar">
              <button
                type="button"
                disabled={claim.isPending || claimable.length === 0 || live.length === 0}
                onClick={() =>
                  claim.mutate({ codeIds: live.map((c) => c.code_id), uids: claimable })
                }
              >
                Claim {live.length} {live.length === 1 ? 'code' : 'codes'} for {claimable.length}{' '}
                selected
              </button>
              <button type="button" className="link" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
            {/* Pick by rank: each button adds everybody of that rank to the
              selection, and pressing it again takes them out. All picks the whole
              roster. Players left out are never picked by either. */}
            <fieldset className="gift-picker">
              <legend className="visually-hidden">Pick by rank</legend>
              <button
                aria-pressed={allSelected(selected, everyone)}
                type="button"
                onClick={() => setSelected((now) => toggleGroup(now, everyone))}
              >
                All ({everyone.length})
              </button>
              {groups.map((group) => (
                <button
                  aria-pressed={allSelected(selected, group.uids)}
                  key={group.label}
                  type="button"
                  onClick={() => setSelected((now) => toggleGroup(now, group.uids))}
                >
                  {group.label} ({group.uids.length})
                </button>
              ))}
            </fieldset>
            <MemberTable
              members={byRank(people)}
              codes={list}
              selected={selected}
              onToggle={toggle}
              onExclude={(uid, excluded) => exclude.mutate({ uid, excluded })}
            />
          </>
        )}
      </section>
    </section>
  );
}

function CodeRow({
  code,
  busy,
  onClaim,
  onCancel,
  onRetire,
}: {
  code: GiftCode;
  busy: boolean;
  onClaim: () => void;
  onCancel: () => void;
  onRetire: () => void;
}) {
  const s = summarise(code);
  return (
    <tr>
      <th scope="row">
        <code>{code.code}</code>
      </th>
      <td>{code.status === 'unverified' ? 'not yet tried' : code.status}</td>
      <td className="numeric">
        {s.received} / {code.members}
      </td>
      <td className="numeric">{s.waiting}</td>
      <td className="numeric">{s.failed}</td>
      <td className="numeric">{s.untouched}</td>
      <td>
        {isLive(code) ? (
          <>
            <button type="button" disabled={busy || s.untouched === 0} onClick={onClaim}>
              Claim for everyone
            </button>{' '}
            {s.waiting > 0 && (
              <button type="button" className="link" disabled={busy} onClick={onCancel}>
                Cancel waiting
              </button>
            )}{' '}
            <button type="button" className="link" disabled={busy} onClick={onRetire}>
              Mark expired
            </button>
          </>
        ) : (
          <span className="muted">retired</span>
        )}
      </td>
    </tr>
  );
}

function MemberTable({
  members,
  codes,
  selected,
  onToggle,
  onExclude,
}: {
  members: GiftMember[];
  codes: GiftCode[];
  selected: ReadonlySet<number>;
  onToggle: (uid: number) => void;
  onExclude: (uid: number, excluded: boolean) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption className="visually-hidden">Who has what</caption>
        <thead>
          <tr>
            <th scope="col">Pick</th>
            <th scope="col">Player</th>
            <th scope="col">Rank</th>
            <th scope="col">Leave out</th>
            {codes.map((c) => (
              <th key={c.code_id} scope="col">
                <code>{c.code}</code>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.game_uid} className={m.excluded ? 'muted' : undefined}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Pick ${m.name}`}
                  checked={selected.has(m.game_uid)}
                  disabled={m.excluded}
                  onChange={() => onToggle(m.game_uid)}
                />
              </td>
              <th scope="row">{m.name}</th>
              <td>{rankLabel(m.rank)}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Never claim for ${m.name}`}
                  checked={m.excluded}
                  onChange={(e) => onExclude(m.game_uid, e.target.checked)}
                />
              </td>
              {codes.map((c) => (
                <td key={c.code_id}>{claimLabel(m.claims[c.code_id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
