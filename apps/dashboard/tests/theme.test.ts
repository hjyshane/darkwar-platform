import { beforeEach, describe, expect, test } from 'vitest';
import {
  type ThemePreference,
  applyTheme,
  nextTheme,
  readTheme,
  storeTheme,
  themeLabel,
} from '../src/lib/theme';

describe('nextTheme', () => {
  test('cycles system to light to dark and back', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  test('three presses return to where they started', () => {
    // The reason system sits first in the order. A cycle that cannot get back
    // to following the machine would make the toggle a one-way door.
    const start: ThemePreference = 'system';
    expect(nextTheme(nextTheme(nextTheme(start)))).toBe(start);
  });
});

describe('readTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  test('is system when nothing was ever chosen', () => {
    expect(readTheme()).toBe('system');
  });

  test('falls back to system when storage holds something unexpected', () => {
    // Not paranoia about our own writes — it is another tab on an older build,
    // or somebody editing devtools. A junk value must not pin the board to a
    // theme with no way back.
    localStorage.setItem('dw-theme', 'solarized');
    expect(readTheme()).toBe('system');
  });

  test('returns what was stored', () => {
    storeTheme('dark');
    expect(readTheme()).toBe('dark');
  });

  test('storing system clears the key rather than writing the word', () => {
    storeTheme('dark');
    storeTheme('system');
    expect(localStorage.getItem('dw-theme')).toBeNull();
    expect(readTheme()).toBe('system');
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  test('light and dark land on the root element', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('system removes the attribute entirely', () => {
    // Not `data-theme="system"`. Every dark rule in the stylesheet is a media
    // query guarded with :not([data-theme="light"]), so no attribute at all is
    // what makes them behave exactly as they did before the toggle existed.
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

test('every state has a label', () => {
  expect(themeLabel('system')).toBe('Auto');
  expect(themeLabel('light')).toBe('Light');
  expect(themeLabel('dark')).toBe('Dark');
});
