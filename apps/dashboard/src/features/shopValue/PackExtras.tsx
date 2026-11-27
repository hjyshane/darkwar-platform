// Extras (0355): what an officer says a pack also pays — a pass's daily
// claim, a milestone reward, a first-buy bonus — when no answer of the game
// lists it. Members see the lines; officers and admins add and remove them.
// The view sums them into the pack's contents, so the rows above this box
// already include them once saved.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type Translate, useT } from '../../lib/i18n';
import type { PackGroup } from './data';
import {
  type ExtraDraft,
  type ExtraMatch,
  type PackExtra,
  deleteExtra,
  extrasOf,
  fetchExtras,
  saveExtra,
} from './extras';

const STALE_TIME = 60_000;

export function useExtras() {
  return useQuery({ queryKey: ['shop-extras'], queryFn: fetchExtras, staleTime: STALE_TIME });
}

function extraLabel(extra: PackExtra, pack: PackGroup, t: Translate): string {
  if (extra.item_id === null) {
    return t('Rubies');
  }
  const known = pack.contents.find((item) => item.id === extra.item_id);
  return known?.name ?? t('Item code {id}', { id: extra.item_id });
}

export function PackExtras({ pack, mayEdit }: { pack: PackGroup; mayEdit: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const extras = useExtras();
  const mine = extrasOf(extras.data ?? [], pack);
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['shop-extras'] });
    void queryClient.invalidateQueries({ queryKey: ['shop-packs'] });
  };
  const remove = useMutation({ mutationFn: deleteExtra, onSuccess: refresh });

  if (!mayEdit && mine.length === 0) {
    return null;
  }
  return (
    <div className="pack-extras">
      <p className="subtle">
        <strong>{t('Extras')}</strong>{' '}
        {t(
          'What an officer says the pack also pays — a daily claim, a milestone reward — summed into the contents above.',
        )}
      </p>
      {mine.length > 0 && (
        <ul className="pack-extras-list">
          {mine.map((extra) => (
            <li key={extra.extra_id}>
              {extraLabel(extra, pack, t)} ×{extra.qty.toLocaleString('en')}
              {extra.repeat > 1 ? ` × ${extra.repeat}` : ''}
              {extra.match_kind === 'name_key' ? ` · ${t('every pack with this name')}` : ''}
              {extra.note ? <span className="muted"> — {extra.note}</span> : null}
              {mayEdit && (
                <button
                  className="link-button muted"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(extra.extra_id)}
                  type="button"
                >
                  {t('Remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {mayEdit &&
        (adding ? (
          <ExtraForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              refresh();
            }}
            pack={pack}
          />
        ) : (
          <button className="link-button muted" onClick={() => setAdding(true)} type="button">
            {t('Add an extra')}
          </button>
        ))}
      {remove.error && <span className="error"> {remove.error.message}</span>}
    </div>
  );
}

function ExtraForm({
  pack,
  onSaved,
  onCancel,
}: {
  pack: PackGroup;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<'item' | 'rubies'>('item');
  const [match, setMatch] = useState<ExtraMatch>(pack.name_key ? 'name_key' : 'pack_id');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [times, setTimes] = useState('1');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: (draft: ExtraDraft) => saveExtra(draft),
    onSuccess: onSaved,
  });

  const matchValue = match === 'name_key' && pack.name_key ? pack.name_key : pack.pack_id;
  const valid =
    Number(qty) > 0 &&
    Number.isInteger(Number(times)) &&
    Number(times) >= 1 &&
    (kind === 'rubies' || /^[0-9]+$/.test(itemId.trim()));

  return (
    <form
      className="pack-extras-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) {
          return;
        }
        save.mutate({
          match_kind: match,
          match_value: matchValue,
          item_id: kind === 'rubies' ? null : itemId.trim(),
          qty: Number(qty),
          repeat: Number(times),
          note,
        });
      }}
    >
      <select
        aria-label={t('Extra')}
        onChange={(e) => setKind(e.target.value as 'item' | 'rubies')}
        value={kind}
      >
        <option value="item">{t('Item')}</option>
        <option value="rubies">{t('Rubies')}</option>
      </select>
      {kind === 'item' && (
        <input
          aria-label={t('Item code')}
          inputMode="numeric"
          onChange={(e) => setItemId(e.target.value)}
          pattern="[0-9]*"
          placeholder={t('Item code')}
          size={9}
          value={itemId}
        />
      )}
      <input
        aria-label={t('Qty')}
        inputMode="decimal"
        min={0}
        onChange={(e) => setQty(e.target.value)}
        placeholder={t('Qty')}
        size={6}
        step="any"
        type="number"
        value={qty}
      />
      <span className="muted">×</span>
      <input
        aria-label={t('Times')}
        inputMode="numeric"
        max={400}
        min={1}
        onChange={(e) => setTimes(e.target.value)}
        placeholder={t('Times')}
        size={4}
        type="number"
        value={times}
      />
      {pack.name_key && (
        <select
          aria-label={t('Applies to')}
          onChange={(e) => setMatch(e.target.value as ExtraMatch)}
          value={match}
        >
          <option value="name_key">{t('every pack with this name')}</option>
          <option value="pack_id">{t('this pack id only')}</option>
        </select>
      )}
      <input
        aria-label={t('Note')}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('Note: where you read it')}
        size={24}
        value={note}
      />
      <button disabled={!valid || save.isPending} type="submit">
        {save.isPending ? t('Saving…') : t('Save')}
      </button>
      <button disabled={save.isPending} onClick={onCancel} type="button">
        {t('Cancel')}
      </button>
      {save.error && <span className="error"> {save.error.message}</span>}
    </form>
  );
}
