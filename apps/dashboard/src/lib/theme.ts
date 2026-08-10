/** Light, dark, or whatever the machine says.
 *
 * THREE STATES, NOT TWO. Every screen followed `prefers-color-scheme` before
 * this existed, and a two-way switch would have quietly taken that away: once
 * you press it you are pinned to one side forever, and somebody whose laptop
 * turns dark at sunset loses that. `system` stays the default and stays
 * reachable, so the toggle adds a choice rather than replacing one.
 *
 * The preference is a single attribute on `<html>`. The stylesheet does the
 * rest — see the `data-theme` rule at the top of index.css.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'dw-theme';

/** The cycle order the button walks. System sits first because it is the
 * default, so pressing three times returns you to where you started. */
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** What was chosen last time, or `system` for a first visit.
 *
 * localStorage throws rather than returning null when the browser has storage
 * switched off entirely, which is a setting a person chooses and not an error
 * this screen should show them. Falling back to `system` is the same thing they
 * had before the toggle existed.
 */
export function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      // Removed rather than stored as the string "system": an absent key and a
      // key saying "follow the machine" mean the same thing, and keeping one
      // spelling of it means there is nothing to migrate if the default moves.
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, preference);
    }
  } catch {
    // A theme that does not survive a reload still works for this visit, and
    // that is worth more than an error message about storage.
  }
}

/** Put the choice where CSS can see it.
 *
 * `system` REMOVES the attribute instead of setting it to "system". The
 * stylesheet's dark rules are `prefers-color-scheme` media queries guarded
 * against `[data-theme="light"]`; with no attribute at all they behave exactly
 * as they did before any of this existed.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
}

export function nextTheme(preference: ThemePreference): ThemePreference {
  const index = ORDER.indexOf(preference);
  return ORDER[(index + 1) % ORDER.length] ?? 'system';
}

export function themeLabel(preference: ThemePreference): string {
  return { system: 'Auto', light: 'Light', dark: 'Dark' }[preference];
}
