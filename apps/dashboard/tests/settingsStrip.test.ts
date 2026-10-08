import { describe, expect, it } from 'vitest';
import { type SettingsStripInput, settingsStrip } from '../src/features/admin/strip';

const input = (over: Partial<SettingsStripInput> = {}): SettingsStripInput => ({
  groupLabel: 'Access',
  usable: 6,
  total: 6,
  alliance: 'CBFW',
  shared: false,
  role: 'admin',
  signedIn: true,
  missing: 0,
  ...over,
});

const cell = (label: string, over: Partial<SettingsStripInput> = {}) =>
  settingsStrip(input(over)).find((entry) => entry.label === label);

describe('settingsStrip', () => {
  it('names the group and how much of it the reader may use', () => {
    expect(cell('Group')?.value).toBe('Access');
    expect(cell('Open to you')).toMatchObject({
      value: '6 of 6',
      note: 'every section in this group',
    });
  });

  it('says how many sections need a permission the reader lacks', () => {
    expect(cell('Open to you', { usable: 4 })).toMatchObject({
      value: '4 of 6',
      note: '2 need a permission you do not hold',
    });
  });

  it('names the alliance a change lands on, or says the group is shared', () => {
    expect(cell('Changes')).toMatchObject({ value: 'CBFW', note: 'this alliance only' });
    expect(cell('Changes', { shared: true })?.value).toBe('Every alliance');
    expect(cell('Changes', { alliance: null })?.note).toBe('no alliance chosen');
  });

  it('shows the role, and what it still lacks', () => {
    expect(cell('Signed in as')).toMatchObject({ value: 'admin', note: 'nothing missing here' });
    expect(cell('Signed in as', { missing: 1, role: 'officer' })).toMatchObject({
      value: 'officer',
      note: 'reading only for some of it',
    });
  });

  it('asks a signed-out reader to sign in rather than showing a role', () => {
    expect(cell('Signed in as', { signedIn: false })).toMatchObject({
      value: null,
      note: 'sign in to change anything',
    });
  });
});
