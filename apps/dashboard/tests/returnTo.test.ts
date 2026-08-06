// Following a link to #/guides while signed out used to end on the overview.
// These are the rules that make it come back instead, and the two that stop it
// looping or firing twice.
import { beforeEach, describe, expect, test } from 'vitest';
import { rememberReturnTo, takeReturnTo } from '../src/lib/returnTo';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('rememberReturnTo', () => {
  test('remembers a real page', () => {
    rememberReturnTo('#/guides');
    expect(takeReturnTo()).toBe('#/guides');
  });

  // The one that would loop: remembering the sign-in page means signing in sends
  // you back to the sign-in page.
  test('refuses the login page', () => {
    rememberReturnTo('#/login');
    expect(takeReturnTo()).toBe('');
  });

  test('refuses the overview, which is where the fallback already goes', () => {
    for (const hash of ['', '#', '#/']) {
      rememberReturnTo(hash);
      expect(takeReturnTo()).toBe('');
    }
  });

  test('the newest page wins', () => {
    rememberReturnTo('#/guides');
    rememberReturnTo('#/members');
    expect(takeReturnTo()).toBe('#/members');
  });

  // A deep link is the case this exists for: a link to one guide, not the board.
  test('keeps the whole address, not just the tab', () => {
    rememberReturnTo('#/player/2b0d0f4e-0000-4000-8000-000000000001');
    expect(takeReturnTo()).toBe('#/player/2b0d0f4e-0000-4000-8000-000000000001');
  });
});

describe('takeReturnTo', () => {
  // Consumed, not read. A second sign-in in the same tab must not revisit a page
  // from before the first one.
  test('fires once', () => {
    rememberReturnTo('#/guides');
    expect(takeReturnTo()).toBe('#/guides');
    expect(takeReturnTo()).toBe('');
  });

  test('nothing remembered is the overview', () => {
    expect(takeReturnTo()).toBe('');
  });

  // Storage that was written before this rule existed, or by hand.
  test('a stored login page is still refused on the way out', () => {
    window.sessionStorage.setItem('dw:returnTo', '#/login');
    expect(takeReturnTo()).toBe('');
  });
});
