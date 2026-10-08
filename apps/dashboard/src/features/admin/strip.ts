// The figures at the head of the Settings screen: which group is open, how much
// of it this reader may use, whose alliance it changes, and who is asking.
//
// Pure, so what the strip claims can be checked on its own. "Open to you"
// counts what usableSectionsIn lets through, the same filter that decides which
// tabs are drawn, so the number and the tab bar cannot disagree.

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

export interface SettingsStripInput {
  groupLabel: string;
  usable: number;
  total: number;
  /** The alliance these settings change, or null for the shared group. */
  alliance: string | null;
  shared: boolean;
  role: string | null;
  signedIn: boolean;
  /** How many requirements this reader lacks for the group. */
  missing: number;
}

export function settingsStrip(input: SettingsStripInput): StripCell[] {
  return [
    { label: 'Group', value: input.groupLabel },
    {
      label: 'Open to you',
      value: `${input.usable} of ${input.total}`,
      note:
        input.usable === input.total
          ? 'every section in this group'
          : `${input.total - input.usable} need a permission you do not hold`,
    },
    input.shared
      ? { label: 'Changes', value: 'Every alliance', note: 'shared settings' }
      : {
          label: 'Changes',
          value: input.alliance,
          note: input.alliance === null ? 'no alliance chosen' : 'this alliance only',
        },
    input.signedIn
      ? {
          label: 'Signed in as',
          value: input.role,
          note: input.missing === 0 ? 'nothing missing here' : 'reading only for some of it',
        }
      : { label: 'Signed in as', value: null, note: 'sign in to change anything' },
  ];
}
