// What packs and Ruby-shop entries are worth (item 3, 0215).
//
// Three tabs. PACKS: every pack on sale, best value first — value is the
// rubies inside plus every item at its ruby value, in dollars, against the
// price. RUBY SHOP: each entry's items at their value against the rubies it
// costs. ITEM VALUES: the price list itself, which officers can correct; a
// correction is theirs and the game tool never overwrites it.
//
// An estimated value is a back-solve from the game's own value claims and can
// be off, so every pack says how much of its value rests on estimates.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSession } from '../../lib/useSession';
import {
  type ItemValue,
  type PackFilter,
  type PackValue,
  SHOP_LABELS,
  byValue,
  dollarsOf,
  estimatedShare,
  fetchItemValues,
  fetchListings,
  fetchPacks,
  isLive,
  money,
  ratioLabel,
  saveItemValue,
} from './data';

const STALE_TIME = 5 * 60_000;

type Tab = 'packs' | 'shop' | 'values';
const TABS: ReadonlyArray<[Tab, string]> = [
  ['packs', 'Packs'],
  ['shop', 'Ruby shop'],
  ['values', 'Item values'],
];

const SOURCE_LABELS = { officer: 'officer', game: 'game', estimated: 'estimated' } as const;

function SourceTag({ source }: { source: string | null }) {
  if (source === null) {
    return <span className="muted">no value</span>;
  }
  return <span className={`value-source value-source-${source}`}>{source}</span>;
}

function PackRow({ pack }: { pack: PackValue }) {
  const [open, setOpen] = useState(false);
  const estimated = estimatedShare(pack);
  return (
    <>
      <tr>
        <td className="label">
          <button
            aria-expanded={open}
            className="link-button"
            onClick={() => setOpen(!open)}
            type="button"
          >
            {open ? '▾' : '▸'} {pack.name}
          </button>
        </td>
        <td className="num">{money(pack.dollars)}</td>
        <td className="num">{money(pack.value_dollars)}</td>
        <td className="num">
          <strong>{ratioLabel(pack.value_ratio)}</strong>
        </td>
        <td className="num">{pack.rubies.toLocaleString('en')}</td>
        <td className="num" title="Share of the value resting on estimated item values">
          {estimated > 0 ? `${Math.round(estimated * 100)}%` : '—'}
        </td>
        <td className="num" title="Contents with no value yet: the ratio leaves them out">
          {pack.unvalued_items > 0 ? pack.unvalued_items : '—'}
        </td>
        <td className="num muted">
          {pack.claimed_percent === null ? '—' : `${pack.claimed_percent}%`}
        </td>
      </tr>
      {open && (
        <tr className="pack-contents">
          <td colSpan={8}>
            <table className="compact">
              <tbody>
                <tr>
                  <td className="label">Rubies</td>
                  <td className="num">{pack.rubies.toLocaleString('en')}</td>
                  <td className="num">{money(dollarsOf(pack.rubies))}</td>
                  <td />
                </tr>
                {pack.contents.map((item) => (
                  <tr key={item.id}>
                    <td className="label">
                      {item.name ?? `Item #${item.id}`}
                      {item.name_ko && <span className="muted"> · {item.name_ko}</span>}
                    </td>
                    <td className="num">×{item.qty.toLocaleString('en')}</td>
                    <td className="num">
                      {item.rubies === null ? '—' : money(dollarsOf(item.rubies * item.qty))}
                    </td>
                    <td>
                      <SourceTag source={item.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function PacksTab({ now }: { now: Date }) {
  const packs = useQuery({ queryKey: ['shop-packs'], queryFn: fetchPacks, staleTime: STALE_TIME });
  const [filter, setFilter] = useState<PackFilter>('live');
  const [price, setPrice] = useState<string>('all');
  const shown = useMemo(() => {
    const rows = (packs.data ?? []).filter(
      (pack) =>
        pack.dollars > 0 &&
        (filter === 'all' || isLive(pack, now)) &&
        (price === 'all' || pack.dollars.toFixed(2) === price),
    );
    return byValue(rows);
  }, [packs.data, filter, price, now]);
  const prices = useMemo(
    () =>
      [...new Set((packs.data ?? []).map((pack) => pack.dollars.toFixed(2)))]
        .filter((p) => p !== '0.00')
        .sort((a, b) => Number(a) - Number(b)),
    [packs.data],
  );

  if (packs.isPending) return <p className="empty">Loading packs…</p>;
  if (packs.isError) return <p className="error">Could not load packs: {packs.error.message}</p>;
  if ((packs.data ?? []).length === 0) {
    return (
      <p className="empty">
        No packs yet. They arrive when the collector sees the pack store opened, and are valued once
        <code> dw-collector game-values</code> has run.
      </p>
    );
  }
  return (
    <>
      <div className="row">
        <label>
          Show{' '}
          <select onChange={(e) => setFilter(e.target.value as PackFilter)} value={filter}>
            <option value="live">On sale now</option>
            <option value="all">Every pack seen</option>
          </select>
        </label>
        <label>
          Price{' '}
          <select onChange={(e) => setPrice(e.target.value)} value={price}>
            <option value="all">Any</option>
            {prices.map((p) => (
              <option key={p} value={p}>
                ${p}
              </option>
            ))}
          </select>
        </label>
        <span className="subtle">{shown.length} packs, best value first.</span>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Pack
              </th>
              <th className="num" scope="col">
                Price
              </th>
              <th className="num" scope="col">
                Worth
              </th>
              <th className="num" scope="col">
                Value
              </th>
              <th className="num" scope="col">
                Rubies
              </th>
              <th className="num" scope="col">
                Estimated
              </th>
              <th className="num" scope="col">
                Unvalued
              </th>
              <th className="num" scope="col" title="What the game itself claims">
                Game says
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((pack) => (
              <PackRow key={`${pack.server_id}:${pack.pack_id}`} pack={pack} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>Value</strong> is dollars of value per dollar paid: the rubies inside plus every
        item at its ruby value, at 100 rubies per $0.99. VIP Points count as nothing.{' '}
        <strong>Estimated</strong> is how much of that rests on values back-solved from the game's
        own claims; <strong>Unvalued</strong> items are left out. Open a pack for its contents.
      </p>
    </>
  );
}

function ShopTab() {
  const listings = useQuery({
    queryKey: ['shop-listings'],
    queryFn: fetchListings,
    staleTime: STALE_TIME,
  });
  if (listings.isPending) return <p className="empty">Loading the shop…</p>;
  if (listings.isError) {
    return <p className="error">Could not load the shop: {listings.error.message}</p>;
  }
  const rows = byValue(listings.data ?? []);
  if (rows.length === 0) {
    return <p className="empty">No Ruby-shop entries yet. Open the shop in the game once.</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Item
              </th>
              <th scope="col">Shop</th>
              <th className="num" scope="col">
                Qty
              </th>
              <th className="num" scope="col">
                Rubies
              </th>
              <th className="num" scope="col">
                Off
              </th>
              <th className="num" scope="col">
                Value
              </th>
              <th scope="col">Basis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.server_id}:${row.shop_type}:${row.listing_id}`}>
                <td className="label">{row.name ?? `Item #${row.item_id ?? row.listing_id}`}</td>
                <td>{SHOP_LABELS[row.shop_type] ?? `Shop ${row.shop_type}`}</td>
                <td className="num">{row.qty.toLocaleString('en')}</td>
                <td className="num">{row.price.toLocaleString('en')}</td>
                <td className="num">{row.discount ? `${row.discount}%` : '—'}</td>
                <td className="num">
                  <strong>{ratioLabel(row.value_ratio)}</strong>
                </td>
                <td>
                  <SourceTag source={row.value_source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>Value</strong> is rubies of value per ruby spent: ×1.0 is list price, ×2.0 is half
        off. Only entries sold for rubies are here; the token shops spend their own currency.
      </p>
    </>
  );
}

function ValueRow({ item, mayEdit }: { item: ItemValue; mayEdit: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ rubies: string; note: string } | null>(null);
  const save = useMutation({
    mutationFn: (value: { rubies: string; note: string }) =>
      saveItemValue(item.item_id, Number(value.rubies), value.note),
    onSuccess: () => {
      setDraft(null);
      for (const key of ['shop-values', 'shop-packs', 'shop-listings']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const valid = draft !== null && draft.rubies.trim() !== '' && Number(draft.rubies) >= 0;
  return (
    <tr>
      <td className="label">
        {item.name ?? `Item #${item.item_id}`}
        {item.name_ko && <span className="muted"> · {item.name_ko}</span>}
      </td>
      <td className="num">
        {draft === null ? (
          item.rubies.toLocaleString('en', { maximumFractionDigits: 2 })
        ) : (
          <input
            aria-label={`Rubies for ${item.name ?? item.item_id}`}
            inputMode="decimal"
            min={0}
            onChange={(e) => setDraft({ ...draft, rubies: e.target.value })}
            step="any"
            type="number"
            value={draft.rubies}
          />
        )}
      </td>
      <td className="num">{money(dollarsOf(item.rubies))}</td>
      <td>
        <SourceTag source={item.source} />
      </td>
      <td className="muted">
        {draft === null ? (
          (item.note ?? '')
        ) : (
          <input
            aria-label="Note"
            maxLength={300}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            value={draft.note}
          />
        )}
      </td>
      {mayEdit && (
        <td>
          {draft === null ? (
            <button
              onClick={() => setDraft({ rubies: String(item.rubies), note: item.note ?? '' })}
              type="button"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                disabled={!valid || save.isPending}
                onClick={() => save.mutate(draft)}
                type="button"
              >
                Save
              </button>{' '}
              <button onClick={() => setDraft(null)} type="button">
                Cancel
              </button>
              {save.error && <span className="error"> {save.error.message}</span>}
            </>
          )}
        </td>
      )}
    </tr>
  );
}

function ValuesTab({ mayEdit }: { mayEdit: boolean }) {
  const values = useQuery({
    queryKey: ['shop-values'],
    queryFn: fetchItemValues,
    staleTime: STALE_TIME,
  });
  const [text, setText] = useState('');
  const [source, setSource] = useState<string>('all');
  if (values.isPending) return <p className="empty">Loading values…</p>;
  if (values.isError) {
    return <p className="error">Could not load values: {values.error.message}</p>;
  }
  const needle = text.trim().toLowerCase();
  const rows = (values.data ?? [])
    .filter((item) => source === 'all' || item.source === source)
    .filter(
      (item) =>
        needle === '' ||
        item.item_id.includes(needle) ||
        (item.name ?? '').toLowerCase().includes(needle) ||
        (item.name_ko ?? '').includes(needle),
    )
    .sort((a, b) => b.rubies - a.rubies);
  return (
    <>
      <div className="row">
        <input
          aria-label="Search items"
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name or id"
          type="search"
          value={text}
        />
        <label>
          Basis{' '}
          <select onChange={(e) => setSource(e.target.value)} value={source}>
            <option value="all">Any</option>
            {Object.keys(SOURCE_LABELS).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <span className="subtle">{rows.length} items</span>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Item
              </th>
              <th className="num" scope="col">
                Rubies each
              </th>
              <th className="num" scope="col">
                $ each
              </th>
              <th scope="col">Basis</th>
              <th scope="col">Note</th>
              {mayEdit && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <ValueRow item={item} key={item.item_id} mayEdit={mayEdit} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>game</strong> is the Ruby shop's own price; <strong>estimated</strong> is
        back-solved from the game's value claims on the packs an item is in, and can be off;{' '}
        <strong>officer</strong> is a value somebody set, which the game tool never overwrites.
      </p>
    </>
  );
}

export function ShopValuePage() {
  const { data: session } = useSession();
  const mayEdit = session?.role === 'officer' || session?.role === 'admin';
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('packs');
  return (
    <main>
      <h2>Shop value</h2>
      <p className="subtle">
        What packs and Ruby-shop entries are worth, in dollars of value per dollar paid.
      </p>
      <div aria-label="Shop value" className="row" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'packs' && <PacksTab now={now} />}
      {tab === 'shop' && <ShopTab />}
      {tab === 'values' && <ValuesTab mayEdit={mayEdit} />}
    </main>
  );
}
