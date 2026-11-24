import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage, useT } from './index';

// The site's default comes from the settings registry; here it is never set.
vi.mock('../settings/useSiteSetting', () => ({
  useSiteSetting: (setting: { defaultValue: unknown }) => setting.defaultValue,
}));

function Probe() {
  const t = useT();
  const { setLanguage } = useLanguage();
  return (
    <>
      <p>{t('Sign out')}</p>
      <button onClick={() => setLanguage('de')} type="button">
        de
      </button>
    </>
  );
}

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LanguageProvider', () => {
  it('speaks English to an English browser with no choice made', async () => {
    show();
    expect(await screen.findByText('Sign out')).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it("follows the reader's stored choice over the browser", async () => {
    window.localStorage.setItem('dw-language', 'ko');
    show();
    expect(await screen.findByText('로그아웃')).toBeTruthy();
    expect(document.documentElement.lang).toBe('ko');
  });

  it('switches when the reader picks, and remembers the pick', async () => {
    show();
    await act(async () => screen.getByRole('button', { name: 'de' }).click());
    expect(await screen.findByText('Abmelden')).toBeTruthy();
    expect(window.localStorage.getItem('dw-language')).toBe('de');
  });
});
