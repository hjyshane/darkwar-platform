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
import { SortableTh } from '../../components/SortableTh';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { GameIcon, useItemIcons } from '../../lib/gameIcons';
import { type SortState, nextSort, sortRows } from '../../lib/tableControls';
import { useSession } from '../../lib/useSession';
import { PackRename } from './PackRename';
import { UnnamedTab } from './UnnamedTab';
import {
  type ItemValue,
  type PackFilter,
  type PackGroup,
  SHOP_LABELS,
  dollarsOf,
  fetchItemValues,
  fetchListings,
  fetchPacks,
  groupPacks,
  isLive,
  itemLabel,
  loadHidden,
  matchesPack,
  money,
  ratioLabel,
  saveItemName,
  saveItemValue,
  storeHidden,
} from './data';

const STALE_TIME = 5 * 60_000;

type Tab = 'packs' | 'shop' | 'values' | 'unnamed';
const TABS: ReadonlyArray<[Tab, string]> = [
  ['packs', 'Packs'],
  ['shop', 'Ruby shop'],
  ['values', 'Item values'],
  ['unnamed', 'Unnamed'],
];

const SOURCE_LABELS = { officer: 'officer', game: 'game', estimated: 'estimated' } as const;

function SourceTag({ source }: { source: string | null }) {
  if (source === null) {
    return <span className="muted">no value</span>;
  }
  return <span className={`value-source value-source-${source}`}>{source}</span>;
}

/** Set one item's value from inside a pack: what an officer reaches for
 * when a pack's ratio looks wrong. Saved as theirs (0215). */
function InlineValue({ itemId, rubies }: { itemId: string; rubies: number | null }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) => saveItemValue(itemId, Number(value), ''),
    onSuccess: () => {
      setDraft(null);
      for (const key of ['shop-values', 'shop-packs', 'shop-listings']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  if (draft === null) {
    return (
      <button
        className="link-button muted"
        onClick={() => setDraft(rubies === null ? '' : String(rubies))}
        type="button"
      >
        edit
      </button>
    );
  }
  const valid = draft.trim() !== '' && Number(draft) >= 0;
  return (
    <span className="row">
      <input
        aria-label={`Rubies per unit for item ${itemId}`}
        inputMode="decimal"
        min={0}
        onChange={(e) => setDraft(e.target.value)}
        step="any"
        type="number"
        value={draft}
      />
      <span className="muted">rubies each</span>
      <button disabled={!valid || save.isPending} onClick={() => save.mutate(draft)} type="button">
        Save
      </button>
      <button onClick={() => setDraft(null)} type="button">
        Cancel
      </button>
      {save.error && <span className="error">{save.error.message}</span>}
    </span>
  );
}

function PackRow({
  pack,
  mayEdit,
  hidden,
  onToggleHidden,
}: {
  pack: PackGroup;
  mayEdit: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Only an opened pack asks for its contents' icons.
  const icons = useItemIcons(
    pack.contents.map((item) => item.id),
    open,
  );
  const estimated = pack.estimated;
  return (
    <>
      <tr className={hidden ? 'pack-hidden' : undefined}>
        <td className="label">
          <button
            aria-expanded={open}
            className="link-button"
            onClick={() => setOpen(!open)}
            type="button"
          >
            {open ? '▾' : '▸'} {pack.name}
          </button>
          {pack.renamed && (
            <span className="muted" title={`Game name: ${pack.game_name}`}>
              {' '}
              ✎
            </span>
          )}
          {pack.offers > 1 && (
            <span
              className="muted"
              title={`The game lists this offer under ${pack.offers} ids: ${pack.pack_ids.join(', ')}`}
            >
              {' '}
              ×{pack.offers} offers
            </span>
          )}
          {mayEdit && <PackRename pack={pack} />}
        </td>
        <td className="num">{money(pack.dollars)}</td>
        {pack.contents_listed ? (
          <>
            <td className="num">{money(pack.value_dollars ?? 0)}</td>
            <td className="num">
              <strong>{ratioLabel(pack.value_ratio)}</strong>
            </td>
          </>
        ) : (
          <td
            className="muted"
            colSpan={2}
            title="A pass or gift that pays out over levels or days; the pack list does not carry its rewards"
          >
            contents not listed
          </td>
        )}
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
        <td className="num muted">{pack.offers}</td>
        <td>
          <button
            aria-label={hidden ? `Show ${pack.name} again` : `Hide ${pack.name}`}
            className="link-button muted"
            onClick={onToggleHidden}
            title={hidden ? 'Show this offer again' : 'Hide this offer (this browser only)'}
            type="button"
          >
            {hidden ? 'unhide' : 'hide'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="pack-contents">
          <td colSpan={10}>
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
                      <GameIcon size={20} src={icons.data?.get(item.id)} />
                      <span title={`Item code ${item.id}`}>{itemLabel(item)}</span>
                    </td>
                    <td className="num">×{item.qty.toLocaleString('en')}</td>
                    <td className="num">
                      {item.rubies === null ? '—' : money(dollarsOf(item.rubies * item.qty))}
                    </td>
                    <td>
                      <SourceTag source={item.source} />
                    </td>
                    {mayEdit && (
                      <td>
                        <InlineValue itemId={item.id} rubies={item.rubies} />
                      </td>
                    )}
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

function PacksTab({ now, mayEdit }: { now: Date; mayEdit: boolean }) {
  const packs = useQuery({ queryKey: ['shop-packs'], queryFn: fetchPacks, staleTime: STALE_TIME });
  const [filter, setFilter] = useState<PackFilter>('live');
  const [price, setPrice] = useState<string>('all');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'value_ratio', direction: 'desc' });
  const onSort = (key: string) => setSort(nextSort(sort, key));
  const [hidden, setHidden] = useState<ReadonlySet<string>>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const toggleHidden = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      storeHidden(next);
      return next;
    });
  const grouped = useMemo(() => {
    const rows = (packs.data ?? []).filter(
      (pack) =>
        pack.dollars > 0 &&
        (filter === 'all' || isLive(pack, now)) &&
        (price === 'all' || pack.dollars.toFixed(2) === price) &&
        matchesPack(pack, text),
    );
    return sortRows(groupPacks(rows), sort);
  }, [packs.data, filter, price, now, sort, text]);
  const hiddenHere = grouped.filter((pack) => hidden.has(pack.key)).length;
  const shown = showHidden ? grouped : grouped.filter((pack) => !hidden.has(pack.key));
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
          <Select onChange={(chosen) => setFilter(chosen as PackFilter)} value={filter}>
            <option value="live">On sale now</option>
            <option value="all">Every pack seen (incl. no longer sold)</option>
          </Select>
        </label>
        <input
          aria-label="Search packs"
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a pack or an item in it"
          type="search"
          value={text}
        />
        <label>
          Price{' '}
          <Select onChange={(chosen) => setPrice(chosen)} value={price}>
            <option value="all">Any</option>
            {prices.map((p) => (
              <option key={p} value={p}>
                ${p}
              </option>
            ))}
          </Select>
        </label>
        {hiddenHere > 0 && (
          <label>
            <input
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              type="checkbox"
            />{' '}
            Show hidden ({hiddenHere})
          </label>
        )}
        <span className="subtle">{shown.length} offers. Click a heading to sort.</span>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                Pack
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="dollars">
                Price
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_dollars">
                Worth
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_ratio">
                Value
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rubies">
                Rubies
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="estimated">
                Estimated
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="unvalued_items">
                Unvalued
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="claimed_percent">
                Game says
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="offers">
                Offers
              </SortableTh>
              <th scope="col">
                <span className="visually-hidden">Hide</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((pack) => (
              <PackRow
                hidden={hidden.has(pack.key)}
                key={pack.key}
                mayEdit={mayEdit}
                onToggleHidden={() => toggleHidden(pack.key)}
                pack={pack}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>Value</strong> is dollars of value per dollar paid: the rubies inside plus every
        item at its ruby value, at 100 rubies per $0.99. VIP Points count as nothing.{' '}
        <strong>Estimated</strong> is how much of that rests on values back-solved from the game's
        own claims; <strong>Unvalued</strong> items are left out. Packs with the same name, price
        and contents are one row — the game lists some offers under many ids (a battle pass per
        tier, a daily deal per slot). Passes and gifts that pay out over time have no listed
        contents, so no value. Open a pack for its contents.
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
  const [sort, setSort] = useState<SortState>({ key: 'value_ratio', direction: 'desc' });
  const onSort = (key: string) => setSort(nextSort(sort, key));
  const listingIcons = useItemIcons(
    (listings.data ?? []).flatMap((row) => (row.item_id ? [row.item_id] : [])),
  );
  if (listings.isPending) return <p className="empty">Loading the shop…</p>;
  if (listings.isError) {
    return <p className="error">Could not load the shop: {listings.error.message}</p>;
  }
  const rows = sortRows(
    (listings.data ?? []).map((row) => ({ ...row, shop: SHOP_LABELS[row.shop_type] ?? '' })),
    sort,
  );
  if (rows.length === 0) {
    return <p className="empty">No Ruby-shop entries yet. Open the shop in the game once.</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                Item
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="shop">
                Shop
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="qty">
                Qty
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="price">
                Rubies
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="discount">
                Off
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_ratio">
                Value
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="value_source">
                Basis
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.server_id}:${row.shop_type}:${row.listing_id}`}>
                <td className="label" title={`Item code ${row.item_id ?? '—'}`}>
                  <GameIcon
                    size={20}
                    src={row.item_id ? listingIcons.data?.get(row.item_id) : undefined}
                  />
                  {itemLabel(row)}
                </td>
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

function ValueRow({
  item,
  mayEdit,
  icon,
}: {
  item: ItemValue;
  mayEdit: boolean;
  icon: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; rubies: string; note: string } | null>(null);
  const save = useMutation({
    mutationFn: async (value: { name: string; rubies: string; note: string }) => {
      // The name and the value are separate rows: a renamed item keeps the
      // game's value, and a revalued one keeps the game's name.
      if (value.name.trim() !== (item.renamed ? (item.name ?? '') : '')) {
        await saveItemName(item.item_id, value.name);
      }
      if (Number(value.rubies) !== item.rubies || value.note.trim() !== (item.note ?? '')) {
        await saveItemValue(item.item_id, Number(value.rubies), value.note);
      }
    },
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
      <td className="label" title={`Item code ${item.item_id}`}>
        {draft === null ? (
          <>
            <GameIcon size={20} src={icon} />
            {itemLabel(item)}
            {item.renamed && (
              <span className="muted" title={`Game name: ${item.game_name ?? 'none'}`}>
                {' '}
                ✎
              </span>
            )}
          </>
        ) : (
          <input
            aria-label="Item name"
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={item.game_name ?? 'Item name'}
            value={draft.name}
          />
        )}
      </td>
      <td className="num">
        {draft === null ? (
          item.rubies.toLocaleString('en', { maximumFractionDigits: 2 })
        ) : (
          <input
            aria-label={`Rubies for ${itemLabel(item)}`}
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
              onClick={() =>
                setDraft({
                  name: item.renamed ? (item.name ?? '') : '',
                  rubies: String(item.rubies),
                  note: item.note ?? '',
                })
              }
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
              <div className="muted">
                Leave the name empty to show the game's name. The item code does not change.
              </div>
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
  const valueIcons = useItemIcons((values.data ?? []).map((item) => item.item_id));
  const [text, setText] = useState('');
  const [source, setSource] = useState<string>('all');
  const [sort, setSort] = useState<SortState>({ key: 'rubies', direction: 'desc' });
  const onSort = (key: string) => setSort(nextSort(sort, key));
  if (values.isPending) return <p className="empty">Loading values…</p>;
  if (values.isError) {
    return <p className="error">Could not load values: {values.error.message}</p>;
  }
  const needle = text.trim().toLowerCase();
  const rows = sortRows(
    (values.data ?? [])
      .filter((item) => source === 'all' || item.source === source)
      .filter(
        (item) =>
          needle === '' ||
          item.item_id.includes(needle) ||
          (item.name ?? '').toLowerCase().includes(needle) ||
          (item.game_name ?? '').toLowerCase().includes(needle) ||
          (item.name_ko ?? '').includes(needle),
      ),
    sort,
  );
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
          <Select onChange={(chosen) => setSource(chosen)} value={source}>
            <option value="all">Any</option>
            {Object.keys(SOURCE_LABELS).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        </label>
        <span className="subtle">{rows.length} items</span>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                Item
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rubies">
                Rubies each
              </SortableTh>
              <th className="num" scope="col">
                $ each
              </th>
              <SortableTh onSort={onSort} sort={sort} sortKey="source">
                Basis
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="note">
                Note
              </SortableTh>
              {mayEdit && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <ValueRow
                icon={valueIcons.data?.get(item.item_id)}
                item={item}
                key={item.item_id}
                mayEdit={mayEdit}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        <strong>game</strong> is the Ruby shop's own price; <strong>estimated</strong> is
        back-solved from the game's value claims on the packs an item is in, and can be off;{' '}
        <strong>officer</strong> is a value somebody set, which the game tool never overwrites.
        Names can be corrected too (✎ marks a corrected name); the item code, shown on hover, is the
        game's and never changes.
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
      <Tabs
        label="Shop value"
        className="row"
        items={TABS.map(([id, label]) => ({ id, label }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'packs' && <PacksTab mayEdit={mayEdit} now={now} />}
      {tab === 'shop' && <ShopTab />}
      {tab === 'values' && <ValuesTab mayEdit={mayEdit} />}
      {tab === 'unnamed' && <UnnamedTab mayEdit={mayEdit} />}
    </main>
  );
}
