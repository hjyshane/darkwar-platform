// The Unnamed tab: every item nobody has a name for, where it turns up, and
// what the game data says about it — enough to recognise it in game. Officers
// name it right here; the name then shows everywhere the item is listed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dollarsOf, fetchItemValues, fetchListings, fetchPacks, money, saveItemName } from './data';
import { type ItemHint, type UnnamedItem, fetchHints, unnamedItems } from './unnamed';

const STALE_TIME = 5 * 60_000;

function NameInput({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const save = useMutation({
    mutationFn: () => saveItemName(itemId, draft),
    onSuccess: () => {
      for (const key of ['shop-values', 'shop-packs', 'shop-listings']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  return (
    <form
      className="pack-rename"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() !== '') save.mutate();
      }}
    >
      <input
        aria-label={`Name for item ${itemId}`}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Name it…"
        value={draft}
      />
      <button disabled={draft.trim() === '' || save.isPending} type="submit">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      {save.error && <span className="error"> {save.error.message}</span>}
    </form>
  );
}

function Seen({ item }: { item: UnnamedItem }) {
  if (item.sightings.length === 0) {
    return (
      <span className="muted">
        in no pack or shop entry captured —{' '}
        {item.source === 'game' ? "only the game's own Ruby price list" : 'only the value list'}
      </span>
    );
  }
  return (
    <ul className="unnamed-seen">
      {item.sightings.map((s) => (
        <li key={`${s.where}|${s.label}|${s.qty}|${s.price}`}>
          ×{s.qty.toLocaleString('en')} in{' '}
          {s.where === 'pack' ? (
            <>
              <strong>{s.label}</strong> <span className="muted">({money(s.price)})</span>
            </>
          ) : (
            <>
              the <strong>{s.label}</strong>{' '}
              <span className="muted">
                for {s.price.toLocaleString('en')} rubies ({money(dollarsOf(s.price))})
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Hint({ hint }: { hint: ItemHint | undefined }) {
  if (!hint) return <span className="muted">not in the game data</span>;
  return (
    <span className="muted">
      type {hint.item_type ?? '—'} · quality {hint.quality ?? '—'}
      {hint.icon && (
        <>
          {' '}
          · icon <code>{hint.icon}</code>
        </>
      )}
    </span>
  );
}

export function UnnamedTab({ mayEdit }: { mayEdit: boolean }) {
  const packs = useQuery({ queryKey: ['shop-packs'], queryFn: fetchPacks, staleTime: STALE_TIME });
  const listings = useQuery({
    queryKey: ['shop-listings'],
    queryFn: fetchListings,
    staleTime: STALE_TIME,
  });
  const values = useQuery({
    queryKey: ['shop-values'],
    queryFn: fetchItemValues,
    staleTime: STALE_TIME,
  });
  const items =
    packs.data && listings.data && values.data
      ? unnamedItems(packs.data, listings.data, values.data)
      : null;
  const ids = (items ?? []).map((i) => i.item_id);
  const hints = useQuery({
    queryKey: ['shop-unnamed-hints', ids.join(',')],
    queryFn: () => fetchHints(ids),
    enabled: items !== null && ids.length > 0,
    staleTime: 60 * 60_000,
  });

  const failed = packs.error ?? listings.error ?? values.error;
  if (failed) return <p className="error">Could not load: {failed.message}</p>;
  if (items === null) return <p className="empty loading">Loading…</p>;
  if (items.length === 0) return <p className="empty">Every item has a name.</p>;

  return (
    <>
      <p className="subtle">
        {items.length} items have no name. Each is listed with the packs and shop entries it comes
        in, and what the game data says about it — the icon name is often the best clue: items
        sharing an icon are usually one family at different levels. An item found nowhere but the
        game's own price list is often one the game has retired, its text gone from every language.
        {mayEdit ? ' Name one here and it shows everywhere.' : ''}
      </p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Item code
              </th>
              <th className="label" scope="col">
                Where it turns up
              </th>
              <th className="label" scope="col">
                Game data
              </th>
              <th className="num" scope="col">
                Value
              </th>
              {mayEdit && <th scope="col">Name</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.item_id}>
                <td className="label">
                  <code>{item.item_id}</code>
                </td>
                <td className="label">
                  <Seen item={item} />
                </td>
                <td className="label">
                  <Hint hint={hints.data?.get(item.item_id)} />
                </td>
                <td className="num">
                  {item.rubies === null ? (
                    '—'
                  ) : (
                    <span title={item.source ?? undefined}>
                      {item.rubies.toLocaleString('en')} rubies
                    </span>
                  )}
                </td>
                {mayEdit && (
                  <td>
                    <NameInput itemId={item.item_id} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
