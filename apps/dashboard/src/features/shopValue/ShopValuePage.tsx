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
import { Fragment, useMemo, useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { Strip } from '../../components/Strip';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { GameIcon, useItemIcons } from '../../lib/gameIcons';
import { type Translate, rich, useT } from '../../lib/i18n';
import { PACK_CATEGORY_BY_TYPE, RUBY_DOLLAR_RATE } from '../../lib/settings/registry';
import { useSiteSetting } from '../../lib/settings/useSiteSetting';
import { type SortState, nextSort, sortRows } from '../../lib/tableControls';
import { useSession } from '../../lib/useSession';
import { PackRename } from './PackRename';
import { UnnamedTab } from './UnnamedTab';
import {
  type ItemValue,
  PACK_CATEGORIES,
  type PackChoiceOption,
  type PackFilter,
  type PackRow as PackRowData,
  SHOP_LABELS,
  bestOption,
  dollarsOf,
  fetchItemValues,
  fetchListings,
  fetchPacks,
  fetchVariantChoices,
  foldVariants,
  groupPacks,
  isGated,
  isInStore,
  isLive,
  itemLabel,
  loadHidden,
  matchesPack,
  money,
  packCategory,
  ratioLabel,
  saveItemName,
  saveItemValue,
  saveVariantChoice,
  storeHidden,
} from './data';
import { shopStrip } from './strip';

const STALE_TIME = 5 * 60_000;

type Tab = 'packs' | 'shop' | 'values' | 'unnamed';
export const TABS: ReadonlyArray<[Tab, string]> = [
  ['packs', 'Packs'],
  ['shop', 'Ruby shop'],
  ['values', 'Item values'],
  ['unnamed', 'Unnamed'],
];

const SOURCE_LABELS = { officer: 'officer', game: 'game', estimated: 'estimated' } as const;

/** A Ruby-shop type's name (SHOP_LABELS), or its number when it has none. */
function shopLabel(type: number, t: Translate): string {
  const label = SHOP_LABELS[type];
  return label === undefined ? t('Shop {type}', { type }) : t(label);
}

/** A value's basis as the reader's language says it; an unknown one as it came. */
function sourceText(source: string, t: Translate): string {
  return source === 'officer'
    ? t('officer')
    : source === 'game'
      ? t('game')
      : source === 'estimated'
        ? t('estimated')
        : source;
}

function SourceTag({ source }: { source: string | null }) {
  const t = useT();
  if (source === null) {
    return <span className="muted">{t('no value')}</span>;
  }
  return <span className={`value-source value-source-${source}`}>{sourceText(source, t)}</span>;
}

/** Set one item's value from inside a pack: what an officer reaches for
 * when a pack's ratio looks wrong. Saved as theirs (0215). */
function InlineValue({ itemId, rubies }: { itemId: string; rubies: number | null }) {
  const t = useT();
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
        {t('edit')}
      </button>
    );
  }
  const valid = draft.trim() !== '' && Number(draft) >= 0;
  return (
    <span className="row">
      <input
        aria-label={t('Rubies per unit for item {id}', { id: itemId })}
        inputMode="decimal"
        min={0}
        onChange={(e) => setDraft(e.target.value)}
        step="any"
        type="number"
        value={draft}
      />
      <span className="muted">{t('rubies each')}</span>
      <button disabled={!valid || save.isPending} onClick={() => save.mutate(draft)} type="button">
        {t('Save')}
      </button>
      <button onClick={() => setDraft(null)} type="button">
        {t('Cancel')}
      </button>
      {save.error && <span className="error">{save.error.message}</span>}
    </span>
  );
}

/** One option of a pick: its rewards under a header that says what the
 * option is worth and whether the pack's value counts it. */
function PickOption({
  number,
  option,
  counted,
  icons,
  mayEdit,
}: {
  number: number;
  option: PackChoiceOption;
  counted: boolean;
  icons: ReadonlyMap<string, string> | undefined;
  mayEdit: boolean;
}) {
  const t = useT();
  const rate = useSiteSetting(RUBY_DOLLAR_RATE);
  return (
    <>
      <tr className={counted ? 'pick-counted' : 'pick-passed'}>
        <td className="label">
          {counted ? '✓ ' : '· '}
          {option.same !== undefined && option.same > 1 ? (
            <span title={(option.names ?? []).join(', ')}>
              {t('Any of {count}', { count: option.same })}
              {(option.names ?? []).length > 0 &&
                ` (${(option.names ?? []).slice(0, 3).join(', ')}${option.same > 3 ? ', …' : ''})`}
            </span>
          ) : (
            <>{t('Option {number}', { number })}</>
          )}
        </td>
        <td />
        <td className="num">{money(dollarsOf(option.rubies, rate))}</td>
        <td className="muted" colSpan={mayEdit ? 2 : 1}>
          {counted ? t('counted') : ''}
          {option.unvalued > 0
            ? ` · ${t('{count} with no value', { count: option.unvalued })}`
            : ''}
        </td>
      </tr>
      {option.items.map((item, index) => (
        <tr key={`${item.id}-${index}`}>
          <td className="label">
            <GameIcon size={20} src={item.type === '40' ? undefined : icons?.get(item.id)} />
            <span
              title={
                item.type === '40'
                  ? t('Hero gear code {id}', { id: item.id })
                  : t('Item code {id}', { id: item.id })
              }
            >
              {itemLabel(item, t)}
            </span>
          </td>
          <td className="num">×{item.qty.toLocaleString('en')}</td>
          <td className="num">
            {item.rubies === null ? '—' : money(dollarsOf(item.rubies * item.qty, rate))}
          </td>
          <td>
            <SourceTag source={item.source} />
          </td>
          {mayEdit && (
            <td>
              {item.type === '40' ? null : <InlineValue itemId={item.id} rubies={item.rubies} />}
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

/** Which of several same-name, same-price packs this server sells (0280).
 * The server lists them all; the game's selling screens name ours (0337),
 * and where none does an officer says which, once. */
function VariantMark({ pack, mayEdit }: { pack: PackRowData; mayEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (variant: string | null) => saveVariantChoice(pack.family_key, variant),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shop-variants'] });
    },
  });
  if (pack.unsold) {
    return (
      <span
        className="pack-variant muted"
        title={t(
          "None of the game's screens sells this pack on this server: another stage's or another server's version",
        )}
      >
        {' '}
        {t('not sold here')}
      </span>
    );
  }
  if (pack.variants < 2) return null;
  if (pack.by_game) {
    return (
      <span
        className="pack-variant"
        title={t("The game's own screen names this version for this server")}
      >
        {' '}
        {pack.variants === 2
          ? t('✓ ours · {count} other version', { count: pack.variants - 1 })
          : t('✓ ours · {count} other versions', { count: pack.variants - 1 })}
      </span>
    );
  }
  return (
    <span className="pack-variant">
      {' '}
      {pack.picked ? (
        <span title={t('An officer marked this as the version this server sells')}>
          {pack.variants === 2
            ? t('✓ ours · {count} other version', { count: pack.variants - 1 })
            : t('✓ ours · {count} other versions', { count: pack.variants - 1 })}
        </span>
      ) : (
        <span
          className="muted"
          title={
            pack.stale
              ? t(
                  'The version that was marked is no longer listed: the game moved to another stage',
                )
              : t('The game lists this name and price in several versions')
          }
        >
          {pack.stale ? `\u26a0 ${t('re-pick')} \u00b7 ` : ''}
          {t('{count} versions', { count: pack.variants })}
        </span>
      )}
      {mayEdit && ' '}
      {mayEdit &&
        (pack.picked ? (
          <button
            className="link-button muted"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
            title={t('Show every version again')}
            type="button"
          >
            {' '}
            {t('change')}
          </button>
        ) : (
          <button
            className="link-button"
            disabled={save.isPending}
            onClick={() => save.mutate(pack.variant_key)}
            title={t('This is the version this server sells; hide the others')}
            type="button"
          >
            {' '}
            {t('this one is ours')}
          </button>
        ))}
      {save.error && <span className="error"> {save.error.message}</span>}
    </span>
  );
}

function PackRow({
  pack,
  mayEdit,
  hidden,
  onToggleHidden,
}: {
  pack: PackRowData;
  mayEdit: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const t = useT();
  const rate = useSiteSetting(RUBY_DOLLAR_RATE);
  const [open, setOpen] = useState(false);
  const byType = useSiteSetting(PACK_CATEGORY_BY_TYPE);
  // Only an opened pack asks for its contents' icons.
  const icons = useItemIcons(
    [
      ...pack.contents,
      ...pack.choices.flat().flatMap((option) => option.items.filter((i) => i.type !== '40')),
    ].map((item) => item.id),
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
          <span className="pack-category" title={t(packCategory(pack.pack_type, byType).label)}>
            {packCategory(pack.pack_type, byType).icon}
          </span>
          {pack.renamed && (
            <span className="muted" title={t('Game name: {name}', { name: pack.game_name })}>
              {' '}
              ✎
            </span>
          )}
          {pack.offers > 1 && (
            <span
              className="muted"
              title={t('The game lists this offer under {count} ids: {ids}', {
                count: pack.offers,
                ids: pack.pack_ids.join(', '),
              })}
            >
              {' '}
              {t('×{count} offers', { count: pack.offers })}
            </span>
          )}
          {pack.choices.length > 0 && (
            <span
              className="muted"
              title={t(
                'The buyer picks part of the contents; the value counts the best option of each pick',
              )}
            >
              {' '}
              ·{' '}
              {pack.choices.length === 1
                ? t('{count} pick', { count: pack.choices.length })
                : t('{count} picks', { count: pack.choices.length })}
            </span>
          )}
          <VariantMark mayEdit={mayEdit} pack={pack} />
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
            title={t(
              'A pass or gift that pays out over levels or days; the pack list does not carry its rewards',
            )}
          >
            {t('contents not listed')}
          </td>
        )}
        <td className="num">{pack.rubies.toLocaleString('en')}</td>
        <td className="num" title={t('Share of the value resting on estimated item values')}>
          {estimated > 0 ? `${Math.round(estimated * 100)}%` : '—'}
        </td>
        <td className="num" title={t('Contents with no value yet: the ratio leaves them out')}>
          {pack.unvalued_items > 0 ? pack.unvalued_items : '—'}
        </td>
        <td className="num muted">
          {pack.claimed_percent === null ? '—' : `${pack.claimed_percent}%`}
        </td>
        <td className="num muted">{pack.offers}</td>
        <td>
          <button
            aria-label={
              hidden
                ? t('Show {name} again', { name: pack.name })
                : t('Hide {name}', { name: pack.name })
            }
            className="link-button muted"
            onClick={onToggleHidden}
            title={hidden ? t('Show this offer again') : t('Hide this offer (this browser only)')}
            type="button"
          >
            {hidden ? t('unhide') : t('hide')}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="pack-contents">
          <td colSpan={10}>
            {pack.offer_track && (
              <p className="subtle">
                {t(
                  "A pass: this is what its {track} track pays over all its levels, read from the game's own screen. The value assumes every level is reached.",
                  { track: pack.offer_track === 'paid' ? t('paid') : pack.offer_track },
                )}
              </p>
            )}
            <table className="compact">
              <tbody>
                <tr>
                  <td className="label">{t('Rubies')}</td>
                  <td className="num">{pack.rubies.toLocaleString('en')}</td>
                  <td className="num">{money(dollarsOf(pack.rubies, rate))}</td>
                  <td />
                </tr>
                {pack.contents.map((item) => (
                  <tr key={item.id}>
                    <td className="label">
                      <GameIcon size={20} src={icons.data?.get(item.id)} />
                      <span title={t('Item code {id}', { id: item.id })}>{itemLabel(item, t)}</span>
                    </td>
                    <td className="num">×{item.qty.toLocaleString('en')}</td>
                    <td className="num">
                      {item.rubies === null ? '—' : money(dollarsOf(item.rubies * item.qty, rate))}
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
                {pack.choices.map((slot, slotIndex) => {
                  const best = bestOption(slot);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a pack's picks are a fixed list, and two slots are often identical
                    <Fragment key={`pick-${slotIndex}`}>
                      <tr>
                        <td className="label muted" colSpan={mayEdit ? 5 : 4}>
                          {slot.length > 1
                            ? t('Pick {number} of {total} — one of {count} (the best is counted)', {
                                number: slotIndex + 1,
                                total: pack.choices.length,
                                count: slot.length,
                              })
                            : t('Pick {number} of {total} — one of {count}', {
                                number: slotIndex + 1,
                                total: pack.choices.length,
                                count: slot.length,
                              })}
                        </td>
                      </tr>
                      {slot.map((option, optionIndex) => (
                        <PickOption
                          counted={option.counted ?? option === best}
                          icons={icons.data}
                          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, and two options can be identical
                          key={`opt-${optionIndex}`}
                          mayEdit={mayEdit}
                          number={optionIndex + 1}
                          option={option}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function PacksTab({ now, mayEdit }: { now: Date; mayEdit: boolean }) {
  const t = useT();
  const byType = useSiteSetting(PACK_CATEGORY_BY_TYPE);
  const packs = useQuery({ queryKey: ['shop-packs'], queryFn: fetchPacks, staleTime: STALE_TIME });
  const [filter, setFilter] = useState<PackFilter>('live');
  const [price, setPrice] = useState<string>('all');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string>('all');
  const variantChoices = useQuery({
    queryKey: ['shop-variants'],
    queryFn: fetchVariantChoices,
    staleTime: STALE_TIME,
  });
  const [showVariants, setShowVariants] = useState(false);
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
  const ofCategory = useMemo(() => {
    const rows = (packs.data ?? []).filter(
      (pack) =>
        pack.dollars > 0 &&
        (filter === 'all' ||
          (filter === 'live' ? isInStore(pack, now) : isLive(pack, now) && isGated(pack))) &&
        (price === 'all' || pack.dollars.toFixed(2) === price) &&
        matchesPack(pack, text),
    );
    return groupPacks(rows);
  }, [packs.data, filter, price, now, text]);
  // Same-name, same-price versions fold to the one an officer marked as ours.
  const folded = useMemo(
    () => foldVariants(ofCategory, variantChoices.data ?? new Map(), showVariants),
    [ofCategory, variantChoices.data, showVariants],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of folded.rows) {
      const key = packCategory(group.pack_type, byType).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [folded.rows, byType]);
  const grouped = useMemo(
    () =>
      sortRows(
        category === 'all'
          ? folded.rows
          : folded.rows.filter((group) => packCategory(group.pack_type, byType).key === category),
        sort,
      ),
    [folded.rows, category, sort, byType],
  );
  const hiddenHere = grouped.filter((pack) => hidden.has(pack.key)).length;
  const shown = showHidden ? grouped : grouped.filter((pack) => !hidden.has(pack.key));
  const prices = useMemo(
    () =>
      [...new Set((packs.data ?? []).map((pack) => pack.dollars.toFixed(2)))]
        .filter((p) => p !== '0.00')
        .sort((a, b) => Number(a) - Number(b)),
    [packs.data],
  );

  if (packs.isPending) return <p className="empty">{t('Loading packs…')}</p>;
  if (packs.isError)
    return (
      <p className="error">
        {t('Could not load packs: {message}', { message: packs.error.message })}
      </p>
    );
  if ((packs.data ?? []).length === 0) {
    return (
      <p className="empty">
        {rich(
          t(
            'No packs yet. They arrive when the collector sees the pack store opened, and are valued once {command} has run.',
          ),
          { command: <code>dw-collector game-values</code> },
        )}
      </p>
    );
  }
  return (
    <>
      <div className="row">
        <label>
          {t('Show')}{' '}
          <Select onChange={(chosen) => setFilter(chosen as PackFilter)} value={filter}>
            <option value="live">{t('In the store now')}</option>
            <option value="event">{t('Event offers (shown only with an event item)')}</option>
            <option value="all">{t('Every pack seen (incl. no longer sold)')}</option>
          </Select>
        </label>
        <input
          aria-label={t('Search packs')}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Search a pack or an item in it')}
          type="search"
          value={text}
        />
        <label>
          {t('Price')}{' '}
          <Select onChange={(chosen) => setPrice(chosen)} value={price}>
            <option value="all">{t('Any')}</option>
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
            {t('Show hidden ({count})', { count: hiddenHere })}
          </label>
        )}
        {(folded.hidden > 0 || showVariants) && (
          <label>
            <input
              checked={showVariants}
              onChange={(e) => setShowVariants(e.target.checked)}
              type="checkbox"
            />{' '}
            {t('Show packs this server does not sell')}
            {folded.hidden > 0 ? ` (${folded.hidden})` : ''}
          </label>
        )}
        <span className="subtle">
          {t('{count} offers. Click a heading to sort.', { count: shown.length })}
        </span>
      </div>
      <fieldset aria-label={t('Pack category')} className="pack-categories">
        <button
          aria-pressed={category === 'all'}
          className="pack-chip"
          onClick={() => setCategory('all')}
          type="button"
        >
          {t('All')} <span className="muted">{folded.rows.length}</span>
        </button>
        {PACK_CATEGORIES.filter((c) => (categoryCounts.get(c.key) ?? 0) > 0).map((c) => (
          <button
            aria-pressed={category === c.key}
            className="pack-chip"
            key={c.key}
            onClick={() => setCategory(category === c.key ? 'all' : c.key)}
            type="button"
          >
            {c.icon} {t(c.label)} <span className="muted">{categoryCounts.get(c.key)}</span>
          </button>
        ))}
      </fieldset>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {t('Pack')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="dollars">
                {t('Price')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_dollars">
                {t('Worth')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_ratio">
                {t('Value')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rubies">
                {t('Rubies')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="estimated">
                {t('Estimated')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="unvalued_items">
                {t('Unvalued')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="claimed_percent">
                {t('Game says')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="offers">
                {t('Offers')}
              </SortableTh>
              <th scope="col">
                <span className="visually-hidden">{t('Hide')}</span>
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
        {rich(
          t(
            "{value} is dollars of value per dollar paid: the rubies inside plus every item at its ruby value, at 100 rubies per $0.99. VIP Points count as nothing. {estimated} is how much of that rests on values back-solved from the game's own claims; {unvalued} items are left out. Packs with the same name, price and contents are one row — the game lists some offers under many ids (a battle pass per tier, a daily deal per slot). The game sends every server's and every stage's packs; the ones its own screens name for this server are the ones shown, and a pass takes its contents from its screen — the paid track over all its levels. A pass or gift no screen has been read for has no listed contents, so no value. Open a pack for its contents.",
          ),
          {
            value: <strong>{t('Value')}</strong>,
            estimated: <strong>{t('Estimated')}</strong>,
            unvalued: <strong>{t('Unvalued')}</strong>,
          },
        )}
      </p>
    </>
  );
}

function ShopTab() {
  const t = useT();
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
  if (listings.isPending) return <p className="empty">{t('Loading the shop…')}</p>;
  if (listings.isError) {
    return (
      <p className="error">
        {t('Could not load the shop: {message}', { message: listings.error.message })}
      </p>
    );
  }
  const rows = sortRows(
    (listings.data ?? []).map((row) => ({ ...row, shop: SHOP_LABELS[row.shop_type] ?? '' })),
    sort,
  );
  if (rows.length === 0) {
    return (
      <p className="empty">{t('No Ruby-shop entries yet. Open the shop in the game once.')}</p>
    );
  }
  return (
    <>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {t('Item')}
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="shop">
                {t('Shop')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="qty">
                {t('Qty')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="price">
                {t('Rubies')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="discount">
                {t('Off')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value_ratio">
                {t('Value')}
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="value_source">
                {t('Basis')}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.server_id}:${row.shop_type}:${row.listing_id}`}>
                <td className="label" title={t('Item code {id}', { id: row.item_id ?? '—' })}>
                  <GameIcon
                    size={20}
                    src={row.item_id ? listingIcons.data?.get(row.item_id) : undefined}
                  />
                  {itemLabel(row, t)}
                </td>
                <td>{shopLabel(row.shop_type, t)}</td>
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
        {rich(
          t(
            '{value} is rubies of value per ruby spent: ×1.0 is list price, ×2.0 is half off. Only entries sold for rubies are here; the token shops spend their own currency.',
          ),
          { value: <strong>{t('Value')}</strong> },
        )}
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
  const t = useT();
  const rate = useSiteSetting(RUBY_DOLLAR_RATE);
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
      <td className="label" title={t('Item code {id}', { id: item.item_id })}>
        {draft === null ? (
          <>
            <GameIcon size={20} src={icon} />
            {itemLabel(item, t)}
            {item.renamed && (
              <span
                className="muted"
                title={t('Game name: {name}', { name: item.game_name ?? t('none') })}
              >
                {' '}
                ✎
              </span>
            )}
          </>
        ) : (
          <input
            aria-label={t('Item name')}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={item.game_name ?? t('Item name')}
            value={draft.name}
          />
        )}
      </td>
      <td className="num">
        {draft === null ? (
          item.rubies.toLocaleString('en', { maximumFractionDigits: 2 })
        ) : (
          <input
            aria-label={t('Rubies for {name}', { name: itemLabel(item, t) })}
            inputMode="decimal"
            min={0}
            onChange={(e) => setDraft({ ...draft, rubies: e.target.value })}
            step="any"
            type="number"
            value={draft.rubies}
          />
        )}
      </td>
      <td className="num">{money(dollarsOf(item.rubies, rate))}</td>
      <td>
        <SourceTag source={item.source} />
      </td>
      <td className="muted">
        {draft === null ? (
          (item.note ?? '')
        ) : (
          <input
            aria-label={t('Note')}
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
              {t('Edit')}
            </button>
          ) : (
            <>
              <span className="actions">
                <button
                  disabled={!valid || save.isPending}
                  onClick={() => save.mutate(draft)}
                  type="button"
                >
                  {t('Save')}
                </button>
                <button onClick={() => setDraft(null)} type="button">
                  {t('Cancel')}
                </button>
              </span>
              {save.error && <span className="error"> {save.error.message}</span>}
              <div className="muted">
                {t("Leave the name empty to show the game's name. The item code does not change.")}
              </div>
            </>
          )}
        </td>
      )}
    </tr>
  );
}

function ValuesTab({ mayEdit }: { mayEdit: boolean }) {
  const t = useT();
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
  if (values.isPending) return <p className="empty">{t('Loading values…')}</p>;
  if (values.isError) {
    return (
      <p className="error">
        {t('Could not load values: {message}', { message: values.error.message })}
      </p>
    );
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
          aria-label={t('Search items')}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Search by name or id')}
          type="search"
          value={text}
        />
        <label>
          {t('Basis')}{' '}
          <Select onChange={(chosen) => setSource(chosen)} value={source}>
            <option value="all">{t('Any')}</option>
            {Object.keys(SOURCE_LABELS).map((key) => (
              <option key={key} value={key}>
                {sourceText(key, t)}
              </option>
            ))}
          </Select>
        </label>
        <span className="subtle">{t('{count} items', { count: rows.length })}</span>
      </div>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {t('Item')}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rubies">
                {t('Rubies each')}
              </SortableTh>
              <th className="num" scope="col">
                {t('$ each')}
              </th>
              <SortableTh onSort={onSort} sort={sort} sortKey="source">
                {t('Basis')}
              </SortableTh>
              <SortableTh onSort={onSort} sort={sort} sortKey="note">
                {t('Note')}
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
        {rich(
          t(
            "{game} is the Ruby shop's own price; {estimated} is back-solved from the game's value claims on the packs an item is in, and can be off; {officer} is a value somebody set, which the game tool never overwrites. Names can be corrected too (✎ marks a corrected name); the item code, shown on hover, is the game's and never changes.",
          ),
          {
            game: <strong>{t('game')}</strong>,
            estimated: <strong>{t('estimated')}</strong>,
            officer: <strong>{t('officer')}</strong>,
          },
        )}
      </p>
    </>
  );
}

export function ShopValuePage() {
  const t = useT();
  const { data: session } = useSession();
  const mayEdit = session?.role === 'officer' || session?.role === 'admin';
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('packs');
  // The same query the Packs tab runs, so the figures cost no second read.
  const packs = useQuery({ queryKey: ['shop-packs'], queryFn: fetchPacks, staleTime: STALE_TIME });
  return (
    <main className="shop-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            SV
          </span>
          <div>
            <h2>{t('Shop value')}</h2>
            <p className="entity-meta">
              <span>{t('What packs and Ruby-shop entries are worth')}</span>
              <span>{t('Dollars of value per dollar paid')}</span>
            </p>
          </div>
        </header>
        {packs.data && <Strip cells={shopStrip(packs.data, now, t)} />}
      </div>
      <Tabs
        label={t('Shop value')}
        className="row"
        items={TABS.map(([id, label]) => ({ id, label: t(label) }))}
        value={tab}
        onChange={setTab}
      />
      <div className="panel">
        {tab === 'packs' && <PacksTab mayEdit={mayEdit} now={now} />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'values' && <ValuesTab mayEdit={mayEdit} />}
        {tab === 'unnamed' && <UnnamedTab mayEdit={mayEdit} />}
      </div>
    </main>
  );
}
