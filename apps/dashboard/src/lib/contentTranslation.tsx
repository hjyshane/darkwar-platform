// "Translate" on what people wrote: notices, guides and comments.
//
// The site's own words are translated in the code (lib/i18n); a post is in
// whatever language its author used. The owner chose (2026-11-24) translation
// in the reader's own browser, with no server and no API: desktop Chrome 138+
// and Edge 148+ ship an on-device translator (the Translator and
// LanguageDetector APIs). Nothing leaves the reader's machine and nothing is
// stored. Where the browser has no such API (phones, Safari, Firefox) the post
// says to use the browser's own page translation instead.
//
// API as documented at developer.chrome.com/docs/ai/translator-api and
// /language-detection: `Translator.availability({sourceLanguage,
// targetLanguage})` -> 'unavailable' | 'downloadable' | 'downloading' |
// 'available'; `Translator.create({..., monitor})` reports `downloadprogress`
// with `loaded` in 0..1; `LanguageDetector.create()` then `detect(text)` ->
// [{ detectedLanguage, confidence }], most likely first.

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { LANGUAGES, useLanguage, useT } from './i18n';

export interface Translated {
  title?: string;
  body?: string;
  /** The text was already in the reader's language: nothing to show. */
  sameLanguage?: boolean;
}

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}

interface ProgressMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: ProgressMonitor) => void;
  }): Promise<BrowserTranslator>;
}

interface LanguageDetectorApi {
  availability(): Promise<string>;
  create(options?: { monitor?: (monitor: ProgressMonitor) => void }): Promise<{
    detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  }>;
}

function apis(): { Translator: TranslatorApi; LanguageDetector: LanguageDetectorApi } | null {
  const scope = globalThis as unknown as {
    Translator?: TranslatorApi;
    LanguageDetector?: LanguageDetectorApi;
  };
  return scope.Translator !== undefined && scope.LanguageDetector !== undefined
    ? { Translator: scope.Translator, LanguageDetector: scope.LanguageDetector }
    : null;
}

/** Whether this browser can translate on the page. */
export function browserCanTranslate(): boolean {
  return apis() !== null;
}

/** unsupported: no usable API here. pair: no model for these two languages.
 * unknown: the text's language could not be told. again: a model must be
 * downloaded and the browser wants a fresh click for that. failed: anything
 * else, a stalled download included. */
export type TranslateFailureReason = 'unsupported' | 'pair' | 'unknown' | 'again' | 'failed';

export class TranslateFailure extends Error {
  constructor(readonly reason: TranslateFailureReason) {
    super(`translate failed: ${reason}`);
  }
}

/** One line of a post: the markup in front of it (a heading's `#`, a bullet,
 * a quote, a list number) kept as written, and the words after it. A line
 * that is only a link or an image, or has no letters, is not translated. */
export function splitLines(
  text: string,
): Array<{ prefix: string; words: string; translate: boolean }> {
  return text.split('\n').map((line) => {
    const match = /^(\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)?)(.*)$/.exec(line);
    const prefix = match?.[1] ?? '';
    const words = match?.[2] ?? line;
    const onlyLink = /^!?\[[^\]]*\]\([^)]*\)$/.test(words.trim());
    return { prefix, words, translate: !onlyLink && /\p{L}/u.test(words) };
  });
}

/** Translate a post body line by line, so headings, lists and image lines keep
 * their markup and the board renders the translation the way it renders the
 * original. Lines go one at a time: the on-device translator is sequential. */
export async function translateLines(
  text: string,
  translate: (words: string) => Promise<string>,
): Promise<string> {
  const out: string[] = [];
  for (const line of splitLines(text)) {
    out.push(
      line.translate ? line.prefix + (await translate(line.words)) : line.prefix + line.words,
    );
  }
  return out.join('\n');
}

/** A browser API call that may never answer: seen in an embedded Chromium
 * whose models are missing, where `Translator.availability` hangs. The reader
 * gets a message instead of a button that spins forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new TranslateFailure('failed')), ms)),
  ]);
}

/** How long a model download may go without progress before it counts as
 * stalled. A download can take minutes on a slow line, so this bounds silence,
 * not the whole download. */
export const STALL_MS = 60_000;

/** Make a model, failing when it goes `stallMs` without answering or reporting
 * progress. Without this a stalled download leaves the button disabled for
 * good, with no way to try again. */
export function createBounded<T>(
  create: (monitor: (monitor: ProgressMonitor) => void) => Promise<T>,
  onProgress: (loaded: number) => void,
  stallMs = STALL_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new TranslateFailure('failed')), stallMs);
    };
    arm();
    create((monitor) =>
      monitor.addEventListener('downloadprogress', (event) => {
        arm();
        onProgress(event.loaded);
      }),
    ).then(
      (made) => {
        clearTimeout(timer);
        resolve(made);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Whether the click that started this is still "user activation". Creating a
 * model that must be downloaded needs one, and awaiting the detector can use
 * it up. A browser without the property is trusted to manage on its own. */
function stillActivated(): boolean {
  const activation = (globalThis.navigator as { userActivation?: { isActive: boolean } })
    ?.userActivation;
  return activation === undefined || activation.isActive;
}

/** Translators already made in this tab, by language pair: creating one can
 * mean a model download, and a reader translating a thread should pay it once. */
const translators = new Map<string, Promise<BrowserTranslator>>();

async function detect(
  api: LanguageDetectorApi,
  text: string,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
  const detector = await createBounded((monitor) => api.create({ monitor }), onProgress);
  const [best] = await detector.detect(text);
  // Short or mixed text is guessed badly; below this the guess is not used.
  if (best === undefined || best.confidence < 0.5) return null;
  return best.detectedLanguage.split('-')[0] ?? null;
}

/** Translate one post or comment into the reader's language, in the browser.
 * What was translated is dropped when the language, the post or the text
 * itself changes (another post opened in the same page, a comment edited), so
 * a reader never sees a translation of something no longer on screen. */
export function useContentTranslation(key: string, fields: { title?: string; body: string }) {
  const { language } = useLanguage();
  const [progress, setProgress] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async (): Promise<Translated> => {
      const api = apis();
      if (api === null) throw new TranslateFailure('unsupported');
      try {
        // A browser that has the API but no detection model (an embedded
        // Chromium, a policy that blocks the download) cannot do this here.
        if ((await withTimeout(api.LanguageDetector.availability(), 10_000)) === 'unavailable') {
          throw new TranslateFailure('unsupported');
        }
        const sample = `${fields.title ?? ''}\n${fields.body}`.trim();
        // A low-confidence guess is not turned into "English": that would tell
        // an English reader a short foreign comment is already theirs.
        const source = await detect(api.LanguageDetector, sample, setProgress);
        if (source === null) throw new TranslateFailure('unknown');
        if (source === language) return { sameLanguage: true };
        const pair = { sourceLanguage: source, targetLanguage: language };
        const id = `${source}>${language}`;
        let made = translators.get(id);
        if (made === undefined) {
          const availability = await withTimeout(api.Translator.availability(pair), 10_000);
          if (availability === 'unavailable') throw new TranslateFailure('pair');
          // Downloading the pack needs the click to still count; waiting on the
          // detector may have used it up. Ask for another press, which then
          // finds the detector ready and goes straight here.
          if (availability !== 'available' && !stillActivated()) {
            throw new TranslateFailure('again');
          }
          made = createBounded(
            (monitor) => api.Translator.create({ ...pair, monitor }),
            setProgress,
          );
          translators.set(id, made);
          // A failed or stalled download is not kept: the next press tries again.
          made.catch(() => translators.delete(id));
        }
        const translator = await made;
        const translate = (words: string) => translator.translate(words);
        return {
          ...(fields.title === undefined ? {} : { title: await translate(fields.title) }),
          body: await translateLines(fields.body, translate),
        };
      } catch (error) {
        throw error instanceof TranslateFailure ? error : new TranslateFailure('failed');
      } finally {
        setProgress(null);
      }
    },
  });
  const { reset } = mutation;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each of these is a trigger, not an input
  useEffect(() => reset(), [language, key, fields.title, fields.body, reset]);
  return { ...mutation, language, progress };
}

/** The button and its states, for a post (above its body) or a comment (in its
 * actions). A browser that cannot translate gets a one-line pointer on a post
 * and nothing on each comment, which would repeat it down the thread. */
export function TranslateControl({
  state,
  shown,
  onShow,
  compact = false,
}: {
  state: ReturnType<typeof useContentTranslation>;
  shown: boolean;
  onShow: (on: boolean) => void;
  compact?: boolean;
}) {
  const t = useT();
  if (!browserCanTranslate()) {
    return compact ? null : (
      <span className="translate-control subtle">
        {t(
          "Your browser can't translate here. Use its own Translate page instead (Chrome and Edge on a computer can translate right here).",
        )}
      </span>
    );
  }
  const name = LANGUAGES.find((entry) => entry.code === state.language)?.name ?? state.language;
  const reason = state.error instanceof TranslateFailure ? state.error.reason : 'failed';
  const same = state.data?.sameLanguage === true;
  return (
    <span className={compact ? 'translate-control translate-compact' : 'translate-control'}>
      {shown && !same ? (
        <>
          {!compact && <span className="subtle">{t('Translated by your browser.')} </span>}
          <button className="linklike" onClick={() => onShow(false)} type="button">
            {t('Show original')}
          </button>
        </>
      ) : (
        <button
          className={compact ? undefined : 'linklike'}
          disabled={state.isPending}
          onClick={() => {
            if (state.data !== undefined) onShow(true);
            else state.mutate(undefined, { onSuccess: () => onShow(true) });
          }}
          type="button"
        >
          {state.isPending
            ? state.progress !== null && state.progress < 1
              ? t('Downloading the translation model… {percent}%', {
                  percent: Math.round(state.progress * 100),
                })
              : t('Translating…')
            : t('Translate into {language}', { language: name })}
        </button>
      )}
      {same && <span className="subtle"> {t('Already in your language.')}</span>}
      {state.isError && (
        <span className="error" role="alert">
          {' '}
          {reason === 'pair'
            ? t('Your browser cannot translate from this language into {language}.', {
                language: name,
              })
            : reason === 'unsupported'
              ? t(
                  "Your browser can't translate here. Use its own Translate page instead (Chrome and Edge on a computer can translate right here).",
                )
              : reason === 'unknown'
                ? t('Your browser could not tell which language this is.')
                : reason === 'again'
                  ? t('Press Translate again to download the language pack.')
                  : t('The translation did not come back. Try again in a moment.')}
        </span>
      )}
    </span>
  );
}
