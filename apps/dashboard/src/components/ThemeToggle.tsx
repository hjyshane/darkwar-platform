import { useState } from 'react';
import {
  type ThemePreference,
  applyTheme,
  nextTheme,
  readTheme,
  storeTheme,
  themeLabel,
} from '../lib/theme';

/** Auto / Light / Dark, in the header beside the other whole-board controls.
 *
 * ONE BUTTON RATHER THAN A SELECT. Three options is under the size where a
 * dropdown earns its two clicks, and the current state is the label — so the
 * control says what it is now, and pressing it says what it will be next.
 *
 * The state is seeded from `readTheme()` rather than from a default, because
 * `main.tsx` has already applied the stored choice to `<html>` before React
 * mounted. Starting at "Auto" here would leave the button disagreeing with the
 * page it sits on until the first press.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readTheme);

  const change = () => {
    const next = nextTheme(preference);
    setPreference(next);
    applyTheme(next);
    storeTheme(next);
  };

  const label = themeLabel(preference);
  return (
    <button
      className="linklike theme-toggle"
      onClick={change}
      // The word alone reads as a label rather than a control, and "Auto" says
      // nothing about what it does. Screen readers get the sentence; everyone
      // else gets it on hover.
      title={`Colour theme: ${label}. Press for ${themeLabel(nextTheme(preference))}.`}
      type="button"
    >
      <span aria-hidden="true">
        {preference === 'dark' ? '◐' : preference === 'light' ? '○' : '◑'}
      </span>
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
}
