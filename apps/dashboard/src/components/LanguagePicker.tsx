import { LANGUAGES, type Language, useLanguage, useT } from '../lib/i18n';
import { isLanguage } from '../lib/i18n/core';

/** The reader's language, in the top bar and on the sign-in page. Each option
 * is written in its own language, so somebody who cannot read the current one
 * can still find theirs. */
export function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  const t = useT();
  return (
    <select
      aria-label={t('Language')}
      className="language-picker"
      onChange={(event) => {
        if (isLanguage(event.target.value)) setLanguage(event.target.value as Language);
      }}
      title={t('Language')}
      value={language}
    >
      {LANGUAGES.map((option) => (
        <option key={option.code} lang={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
