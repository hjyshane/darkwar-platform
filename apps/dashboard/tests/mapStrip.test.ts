import { describe, expect, it } from 'vitest';
import { type MapStripInput, mapStrip } from '../src/features/map/strip';

const input = (over: Partial<MapStripInput> = {}): MapStripInput => ({
  serverId: 581,
  swept: '2 days ago',
  scannedServers: 3,
  levelCount: null,
  nameCount: null,
  selected: false,
  ...over,
});

const cell = (label: string, over: Partial<MapStripInput> = {}) =>
  mapStrip(input(over)).find((entry) => entry.label === label);

describe('mapStrip', () => {
  it('names the server, when it was swept and how many are scanned', () => {
    expect(cell('Server')?.value).toBe('581');
    expect(cell('Last swept')?.value).toBe('2 days ago');
    expect(cell('Servers scanned')?.value).toBe('3');
  });

  it('says nothing is drawn yet, rather than zero found', () => {
    expect(cell('Showing')).toMatchObject({ value: 'Nothing yet' });
  });

  it('counts bases from a level range, in the singular for one', () => {
    expect(cell('Showing', { levelCount: 12 })).toMatchObject({
      value: '12 bases',
      note: 'by HQ level',
    });
    expect(cell('Showing', { levelCount: 1 })?.value).toBe('1 base');
    expect(cell('Showing', { levelCount: 0 })?.value).toBe('0 bases');
  });

  it('counts name matches', () => {
    expect(cell('Showing', { nameCount: 2 })).toMatchObject({
      value: '2 matches',
      note: 'by name',
    });
    expect(cell('Showing', { nameCount: 1 })?.value).toBe('1 match');
  });

  it('a picked player wins over any list behind it', () => {
    expect(cell('Showing', { selected: true, levelCount: 9, nameCount: 4 })?.value).toBe('1 base');
  });
});
