// "Translate" on what people wrote: notices, guides and comments (0349).
//
// The site's own words are translated in the code (lib/i18n); a post is in
// whatever language its author used. A reader who cannot read it presses
// Translate, the `translate` Edge Function asks Claude once, and the answer is
// kept for the next reader of the same text in the same language.

import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LANGUAGES, useLanguage, useT } from './i18n';
import { supabase } from './supabase';

export type TranslatableKind = 'notice' | 'guide' | 'comment';

export interface Translated {
  title?: string;
  body?: string;
}

/** The error a reader sees, from the function's status: the reasons differ in
 * what the reader can do about them. */
export function translationProblem(status: number | null, t: (text: string) => string): string {
  switch (status) {
    case 429:
      return t('You have used your translations for today. Try again tomorrow.');
    case 403:
      return t('Translation is switched off.');
    case 503:
      return t('Translation is not set up on this site yet.');
    case 404:
      return t('This could not be translated: it is gone, or not yours to read.');
    default:
      return t('The translation did not come back. Try again in a moment.');
  }
}

class TranslateError extends Error {
  constructor(readonly status: number | null) {
    super(`translate failed (${status ?? 'network'})`);
  }
}

/** Translate one post or comment into the reader's language. Picking another
 * language drops what was shown, so a reader never sees a translation into a
 * language they just left. */
export function useContentTranslation(kind: TranslatableKind, id: string) {
  const { language } = useLanguage();
  const mutation = useMutation({
    mutationFn: async (): Promise<Translated> => {
      const { data, error } = await supabase.functions.invoke<Translated>('translate', {
        body: { kind, id, language },
      });
      if (error) {
        const status =
          'context' in error && error.context instanceof Response ? error.context.status : null;
        throw new TranslateError(status);
      }
      return data ?? {};
    },
  });
  const { reset } = mutation;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new language is the trigger
  useEffect(() => reset(), [language, reset]);
  return { ...mutation, language };
}

/** The button and its states, for a post (above its body) or a comment (in its
 * actions). `shown` is the translation on screen, or null for the original. */
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
  const name = LANGUAGES.find((entry) => entry.code === state.language)?.name ?? state.language;
  const failed = state.error instanceof TranslateError ? state.error.status : null;
  return (
    <span className={compact ? 'translate-control translate-compact' : 'translate-control'}>
      {shown ? (
        <>
          {!compact && <span className="subtle">{t('Machine translation.')} </span>}
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
          {state.isPending ? t('Translating…') : t('Translate into {language}', { language: name })}
        </button>
      )}
      {state.isError && (
        <span className="error" role="alert">
          {' '}
          {translationProblem(failed, t)}
        </span>
      )}
    </span>
  );
}
