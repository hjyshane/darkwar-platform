import { useState } from 'react';
import {
  type ThemePreference,
  applyTheme,
  nextTheme,
  readTheme,
  storeTheme,
  themeLabel,
} from '../lib/theme';

/** Auto / Light / Dark, as one icon button at the right end of the header.
 *
 * ONE BUTTON RATHER THAN A SELECT. Three options is under the size where a
 * dropdown earns its two clicks, and the current state is the icon — monitor
 * for Auto, sun for Light, moon for Dark. The sentence a screen reader (and a
 * hover) gets carries what a bare icon cannot: what it is now and what a press
 * makes it.
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
  const sentence = `Colour theme: ${label}. Press for ${themeLabel(nextTheme(preference))}.`;
  return (
    <button
      aria-label={sentence}
      className="theme-toggle"
      onClick={change}
      title={sentence}
      type="button"
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}

/** Lucide-style outline icons, drawn inline so the bundle carries no icon
 * library for three small pictures. `currentColor` keeps them on the muted
 * header colour and lets hover brighten them with plain CSS. */
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  // `aria-hidden` sits literally on each svg rather than in this object:
  // biome's noSvgWithoutTitle cannot see attributes through a spread.
  const shared = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
  } as const;
  if (preference === 'light') {
    return (
      <svg aria-hidden="true" {...shared}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
      </svg>
    );
  }
  if (preference === 'dark') {
    return (
      <svg aria-hidden="true" {...shared}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  // Auto: the machine's own setting, so the machine.
  return (
    <svg aria-hidden="true" {...shared}>
      <rect height="14" rx="2" width="20" x="2" y="3" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  );
}
