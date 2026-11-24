// The reader's language, for the whole app (core.ts says how translation works).
//
// Chosen in this order: what the reader picked (kept in this browser), the
// browser's own languages, then the site's default an admin set in Settings ›
// Shared › Site values. English needs no file; every other catalogue is
// fetched the first time it is chosen, so nobody downloads eight languages to
// read one.

import {
  Fragment,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { DEFAULT_LANGUAGE } from '../settings/registry';
import { useSiteSetting } from '../settings/useSiteSetting';
import {
  type Catalog,
  type Language,
  type Translate,
  english,
  isLanguage,
  pickLanguage,
  translator,
} from './core';

export { LANGUAGES, type Language, type Translate } from './core';

const STORAGE_KEY = 'dw-language';

const LOADERS: Record<Exclude<Language, 'en'>, () => Promise<Catalog>> = {
  ko: () => import('./catalogs/ko').then((m) => m.ko),
  fr: () => import('./catalogs/fr').then((m) => m.fr),
  tr: () => import('./catalogs/tr').then((m) => m.tr),
  it: () => import('./catalogs/it').then((m) => m.it),
  es: () => import('./catalogs/es').then((m) => m.es),
  de: () => import('./catalogs/de').then((m) => m.de),
  zh: () => import('./catalogs/zh').then((m) => m.zh),
  vi: () => import('./catalogs/vi').then((m) => m.vi),
};

/** Load a catalogue: the module, or null for English. Exported for tests. */
export function loadCatalog(language: Language): Promise<Catalog | null> {
  return language === 'en' ? Promise.resolve(null) : LOADERS[language]();
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageState>({
  language: 'en',
  setLanguage: () => undefined,
  t: english,
});

function storedChoice(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const siteDefault = useSiteSetting(DEFAULT_LANGUAGE);
  const [picked, setPicked] = useState<string | null>(storedChoice);
  const language = pickLanguage(
    picked,
    typeof navigator === 'undefined' ? [] : navigator.languages,
    isLanguage(siteDefault) ? siteDefault : 'en',
  );
  const [catalog, setCatalog] = useState<{ language: Language; messages: Catalog | null }>({
    language: 'en',
    messages: null,
  });

  useEffect(() => {
    let live = true;
    loadCatalog(language).then(
      (messages) => {
        if (live) setCatalog({ language, messages });
      },
      () => {
        // A catalogue that will not load leaves the site in English rather
        // than half-switched; picking again retries.
        if (live) setCatalog({ language: 'en', messages: null });
      },
    );
    document.documentElement.lang = language;
    return () => {
      live = false;
    };
  }, [language]);

  const value = useMemo<LanguageState>(
    () => ({
      language,
      setLanguage: (next) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Lasts until reload instead.
        }
        setPicked(next);
      },
      // Until the catalogue arrives the page stays in English, never a mix.
      t: catalog.language === language ? translator(catalog.messages) : english,
    }),
    [language, catalog],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The translator for the reader's language. English outside a provider. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}

export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}

/** A translated sentence with elements in it: pass the translated template
 * ("Accept the {terms}.") and a node per placeholder ({ terms: <a …/> }). The
 * sentence stays whole, so each language puts the link where its grammar
 * wants it. */
export function rich(template: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence never reorder
      <Fragment key={index}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>
    );
  });
}
