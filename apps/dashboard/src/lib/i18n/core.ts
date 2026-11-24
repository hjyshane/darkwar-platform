// The site in nine languages (owner, 2026-11-24): English first, then Korean,
// French, Turkish, Italian, Spanish, German, Chinese (simplified) and
// Vietnamese.
//
// THE KEY IS THE ENGLISH TEXT. `t('Sign out')` prints "Sign out" in English
// and looks the same words up in the reader's catalogue otherwise. Over a
// hundred thousand lines of screens written in English, that is what lets a
// screen move to translation one string at a time, with no table of invented
// key names to keep in step: the English is already there, and anything not
// yet wrapped in t() simply stays English.
//
// Placeholders are `{name}`, filled from the second argument, and must appear
// in every translation (i18n.test.ts checks). Every string wrapped in t() must
// be in every catalogue, so a language never silently falls back half-way
// through a screen; the same test fails when one is missing.
//
// NOT TRANSLATED, on purpose: game event and feature names (Black Gold,
// Frankie, Capital Clash, Hive...) are names, kept as the game's English;
// text an admin wrote (renamed tabs, notices, guides); and anything the game
// itself sends.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'zh', name: '简体中文' },
  { code: 'vi', name: 'Tiếng Việt' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export type Catalog = Readonly<Record<string, string>>;

export type Vars = Readonly<Record<string, string | number>>;

/** Look `text` up in `catalog` (English when absent) and fill its `{name}`s. */
export type Translate = (text: string, vars?: Vars) => string;

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.code === value);
}

export function fill(template: string, vars?: Vars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export function translator(catalog: Catalog | null): Translate {
  return (text, vars) => fill(catalog?.[text] ?? text, vars);
}

/** English: what every pure function uses when nobody passes a translator. */
export const english: Translate = translator(null);

/** The placeholders in a template, sorted: `{count} of {total}` -> count,total. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
}

/** The language a first visit gets: the browser's first language this site
 * speaks, else the admin's default. `zh-TW` and `zh-CN` both read as `zh`. */
export function pickLanguage(
  stored: string | null,
  browser: readonly string[],
  siteDefault: Language,
): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return siteDefault;
}
