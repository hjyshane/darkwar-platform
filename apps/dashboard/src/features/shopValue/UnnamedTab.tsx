// The Unnamed tab: every item nobody has a name for, where it turns up, and
// what the game data says about it — enough to recognise it in game. Officers
// name it right here; the name then shows everywhere the item is listed.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { rich, useT } from '../../lib/i18n';
import { RUBY_DOLLAR_RATE } from '../../lib/settings/registry';
import { useSiteSetting } from '../../lib/settings/useSiteSetting';
import { dollarsOf, fetchItemValues, fetchListings, fetchPacks, money, saveItemName } from './data';
import { type ItemHint, type UnnamedItem, fetchHints, unnamedItems } from './unnamed';

const STALE_TIME = 5 * 60_000;

function NameInput({ itemId }: { itemId: string }) {
  const t = useT();
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
        aria-label={t('Name for item {id}', { id: itemId })}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('Name it…')}
        value={draft}
      />
      <button disabled={draft.trim() === '' || save.isPending} type="submit">
        {save.isPending ? t('Saving…') : t('Save')}
      </button>
      {save.error && <span className="error"> {save.error.message}</span>}
    </form>
  );
}

function Seen({ item }: { item: UnnamedItem }) {
  const t = useT();
  const rate = useSiteSetting(RUBY_DOLLAR_RATE);
  if (item.sightings.length === 0) {
    return (
      <span className="muted">
        {item.source === 'game'
          ? t("in no pack or shop entry captured — only the game's own Ruby price list")
          : t('in no pack or shop entry captured — only the value list')}
      </span>
    );
  }
  return (
    <ul className="unnamed-seen">
      {item.sightings.map((s) => (
        <li key={`${s.where}|${s.label}|${s.qty}|${s.price}`}>
          {s.where === 'pack'
            ? rich(t('×{qty} in {pack} {price}'), {
                qty: s.qty.toLocaleString('en'),
                pack: <strong>{s.label}</strong>,
                price: <span className="muted">({money(s.price)})</span>,
              })
            : rich(t('×{qty} in the {shop} {price}'), {
                qty: s.qty.toLocaleString('en'),
                shop: <strong>{s.label}</strong>,
                price: (
                  <span className="muted">
                    {t('for {rubies} rubies ({dollars})', {
                      rubies: s.price.toLocaleString('en'),
                      dollars: money(dollarsOf(s.price, rate)),
                    })}
                  </span>
                ),
              })}
        </li>
      ))}
    </ul>
  );
}

function Hint({ hint }: { hint: ItemHint | undefined }) {
  const t = useT();
  if (!hint) return <span className="muted">{t('not in the game data')}</span>;
  return (
    <span className="muted">
      {t('type {type} · quality {quality}', {
        type: hint.item_type ?? '—',
        quality: hint.quality ?? '—',
      })}
      {hint.icon && <> · {rich(t('icon {name}'), { name: <code>{hint.icon}</code> })}</>}
    </span>
  );
}

export function UnnamedTab({ mayEdit }: { mayEdit: boolean }) {
  const t = useT();
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
      ? unnamedItems(packs.data, listings.data, values.data, t)
      : null;
  const ids = (items ?? []).map((i) => i.item_id);
  const hints = useQuery({
    queryKey: ['shop-unnamed-hints', ids.join(',')],
    queryFn: () => fetchHints(ids),
    enabled: items !== null && ids.length > 0,
    staleTime: 60 * 60_000,
  });

  const failed = packs.error ?? listings.error ?? values.error;
  if (failed)
    return <p className="error">{t('Could not load: {message}', { message: failed.message })}</p>;
  if (items === null) return <p className="empty loading">{t('Loading…')}</p>;
  if (items.length === 0) return <p className="empty">{t('Every item has a name.')}</p>;

  return (
    <>
      <p className="subtle">
        {t(
          "{count} items have no name. Each is listed with the packs and shop entries it comes in, and what the game data says about it — the icon name is often the best clue: items sharing an icon are usually one family at different levels. An item found nowhere but the game's own price list is often one the game has retired, its text gone from every language.",
          { count: items.length },
        )}
        {mayEdit ? ` ${t('Name one here and it shows everywhere.')}` : ''}
      </p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                {t('Item code')}
              </th>
              <th className="label" scope="col">
                {t('Where it turns up')}
              </th>
              <th className="label" scope="col">
                {t('Game data')}
              </th>
              <th className="num" scope="col">
                {t('Value')}
              </th>
              {mayEdit && <th scope="col">{t('Name')}</th>}
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
                      {t('{count} rubies', { count: item.rubies.toLocaleString('en') })}
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
