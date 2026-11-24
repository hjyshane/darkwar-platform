import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TranslateFailure,
  browserCanTranslate,
  createBounded,
  splitLines,
  translateLines,
  useContentTranslation,
  withTimeout,
} from '../src/lib/contentTranslation';

// The reader is English unless a test says otherwise (no provider: useLanguage
// falls back to English).

/** A browser translator that upper-cases, and a detector that says Korean. */
function installBrowserApis(
  options: {
    detected?: string;
    confidence?: number;
    availability?: string;
    detector?: string;
  } = {},
) {
  const created: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  scope.LanguageDetector = {
    availability: async () => options.detector ?? 'available',
    create: async () => ({
      detect: async () => [
        { detectedLanguage: options.detected ?? 'ko', confidence: options.confidence ?? 0.9 },
      ],
    }),
  };
  scope.Translator = {
    availability: async () => options.availability ?? 'available',
    create: async (pair: { sourceLanguage: string; targetLanguage: string }) => {
      created.push(`${pair.sourceLanguage}>${pair.targetLanguage}`);
      return { translate: async (text: string) => text.toUpperCase() };
    },
  };
  return created;
}

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  scope.LanguageDetector = undefined;
  scope.Translator = undefined;
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('splitLines and translateLines', () => {
  it('keeps headings, bullets, quotes and numbers, and leaves link-only and blank lines alone', async () => {
    const body =
      '# Rally\n- gather at 20:00\n\n![map](https://x.test/a.png)\n> be on time\n2. bring troops';
    expect(splitLines(body).map((line) => [line.prefix, line.translate])).toEqual([
      ['# ', true],
      ['- ', true],
      ['', false],
      ['', false],
      ['> ', true],
      ['2. ', true],
    ]);
    expect(await translateLines(body, async (words) => words.toUpperCase())).toBe(
      '# RALLY\n- GATHER AT 20:00\n\n![map](https://x.test/a.png)\n> BE ON TIME\n2. BRING TROOPS',
    );
  });
});

describe('useContentTranslation', () => {
  it('knows when the browser cannot translate, and says so instead of failing silently', async () => {
    expect(browserCanTranslate()).toBe(false);
    const { result } = renderHook(() => useContentTranslation('comment:c1', { body: '안녕' }), {
      wrapper,
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as TranslateFailure).reason).toBe('unsupported');
  });

  it('translates title and body in the browser, from the detected language', async () => {
    const created = installBrowserApis();
    expect(browserCanTranslate()).toBe(true);
    const { result } = renderHook(
      () => useContentTranslation('announcements:p1', { title: 'rally', body: '- go\nnow' }),
      { wrapper },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ title: 'RALLY', body: '- GO\nNOW' }));
    expect(created).toEqual(['ko>en']);
  });

  it('says the text is already in the reader’s language instead of translating it', async () => {
    installBrowserApis({ detected: 'en' });
    const { result } = renderHook(() => useContentTranslation('comment:c1', { body: 'hello' }), {
      wrapper,
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ sameLanguage: true }));
  });

  it('treats a browser with the API but no detection model as one that cannot translate here', async () => {
    installBrowserApis({ detector: 'unavailable' });
    const { result } = renderHook(() => useContentTranslation('comment:c8', { body: '안녕' }), {
      wrapper,
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as TranslateFailure).reason).toBe('unsupported');
  });

  it('gives up on a browser call that never answers', async () => {
    vi.useFakeTimers();
    try {
      const never = withTimeout(new Promise<never>(() => undefined), 10_000);
      // The expectation is attached before time moves, so the rejection is handled.
      const check = expect(never).rejects.toBeInstanceOf(TranslateFailure);
      await vi.advanceTimersByTimeAsync(10_000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('says it cannot tell the language rather than guessing English (codex review on #679)', async () => {
    const created = installBrowserApis({ detected: 'de', confidence: 0.3 });
    const { result } = renderHook(() => useContentTranslation('comment:c9', { body: 'ja' }), {
      wrapper,
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as TranslateFailure).reason).toBe('unknown');
    expect(created).toEqual([]);
  });

  it('asks for another press when a pack must download and the click has expired (codex review on #679)', async () => {
    const created = installBrowserApis({ detected: 'fr', availability: 'downloadable' });
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: false },
    });
    try {
      const { result } = renderHook(() => useContentTranslation('comment:c10', { body: 'Salut' }), {
        wrapper,
      });
      act(() => result.current.mutate());
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect((result.current.error as TranslateFailure).reason).toBe('again');
      expect(created).toEqual([]);
    } finally {
      Reflect.deleteProperty(navigator, 'userActivation');
    }
  });

  it('reports a language pair the browser cannot translate', async () => {
    installBrowserApis({ detected: 'vi', availability: 'unavailable' });
    const { result } = renderHook(() => useContentTranslation('comment:c9', { body: 'xin chào' }), {
      wrapper,
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as TranslateFailure).reason).toBe('pair');
  });

  it('drops a translation when the text it came from changes (codex review on #677)', async () => {
    installBrowserApis();
    const { result, rerender } = renderHook(
      ({ key, body }) => useContentTranslation(key, { body }),
      { wrapper, initialProps: { key: 'comment:c1', body: '토요일' } },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ body: '토요일' }));

    // The same comment, edited: the old translation must not stay on screen.
    rerender({ key: 'comment:c1', body: '일요일' });
    await waitFor(() => expect(result.current.data).toBeUndefined());

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ body: '일요일' }));

    // Another post opened in the same page.
    rerender({ key: 'comment:c2', body: '일요일' });
    await waitFor(() => expect(result.current.data).toBeUndefined());
  });
});

describe('createBounded (codex review on #679)', () => {
  it('fails a download that goes silent, but not one that keeps reporting progress', async () => {
    vi.useFakeTimers();
    try {
      const silent = createBounded(
        () => new Promise<never>(() => {}),
        () => {},
        1_000,
      );
      const failed = expect(silent).rejects.toBeInstanceOf(TranslateFailure);
      await vi.advanceTimersByTimeAsync(1_001);
      await failed;

      let report: ((event: { loaded: number }) => void) | undefined;
      let finish: ((value: string) => void) | undefined;
      const seen: number[] = [];
      const slow = createBounded<string>(
        (monitor) => {
          monitor({
            addEventListener: (_type, listener) => {
              report = listener;
            },
          });
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        (loaded) => seen.push(loaded),
        1_000,
      );
      for (const loaded of [0.25, 0.5, 0.75]) {
        await vi.advanceTimersByTimeAsync(900);
        report?.({ loaded });
      }
      finish?.('model');
      expect(await slow).toBe('model');
      expect(seen).toEqual([0.25, 0.5, 0.75]);
    } finally {
      vi.useRealTimers();
    }
  });
});
