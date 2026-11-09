import { describe, expect, it } from 'vitest';
import { catalogueFrom, itemRefKey, parseItemRef, resolveItemRef } from './itemRef';

describe('parseItemRef', () => {
  it('coerces a numeric id to the string the catalogue is keyed by', () => {
    expect(parseItemRef({ kind: 'item', id: 253042 })).toEqual({ kind: 'item', id: '253042' });
  });
  it('refuses a kind the catalogue cannot resolve', () => {
    expect(parseItemRef({ kind: 'spell', id: '1' })).toBeNull();
    expect(parseItemRef('item:1')).toBeNull();
    expect(parseItemRef({ kind: 'item' })).toBeNull();
  });
  it('keys as kind:id so resource 25 and item 25 stay apart', () => {
    expect(itemRefKey({ kind: 'resource', id: '25' })).toBe('resource:25');
    expect(itemRefKey({ kind: 'item', id: '25' })).toBe('item:25');
  });
});

describe('resolveItemRef', () => {
  const catalogue = catalogueFrom({
    items: [{ item_id: '253042', name: 'Orange Hero Shard' }],
    resources: [{ resource_id: 25, name: 'Wood' }],
    heroes: [{ hero_id: 7, name: 'Guy' }],
    iconRefs: [{ kind: 'item', ref_id: '253042', icon_key: 'icon_shard_orange' }],
  });

  it('names an item and finds its icon', () => {
    expect(resolveItemRef({ kind: 'item', id: '253042' }, catalogue)).toEqual({
      ref: { kind: 'item', id: '253042' },
      label: 'Orange Hero Shard',
      iconKey: 'icon_shard_orange',
    });
  });
  it('names a resource and a hero with no icon', () => {
    expect(resolveItemRef({ kind: 'resource', id: '25' }, catalogue).label).toBe('Wood');
    expect(resolveItemRef({ kind: 'hero', id: '7' }, catalogue)).toEqual({
      ref: { kind: 'hero', id: '7' },
      label: 'Guy',
      iconKey: null,
    });
  });
  it('falls back to kind and id for something the catalogue has not met', () => {
    expect(resolveItemRef({ kind: 'item', id: '9' }, catalogue).label).toBe('item 9');
  });
});
