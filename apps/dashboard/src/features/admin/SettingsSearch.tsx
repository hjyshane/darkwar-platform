import { useState } from 'react';
import type { AdminSection } from '../../lib/adminAccess';
import { SITE_SETTINGS } from '../../lib/settings/registry';
import { searchSettings } from '../../lib/settings/search';

/** A box above the groups that finds a setting by name in any of them. Only
 * sections the reader may use are searched: a hit that opens onto "Nothing
 * here is yours" is worse than no hit. */
export function SettingsSearch({ sections }: { sections: readonly AdminSection[] }) {
  const [query, setQuery] = useState('');
  const hits = searchSettings(query, sections, SITE_SETTINGS);
  const searching = query.trim() !== '';

  return (
    <div className="settings-search">
      <label htmlFor="settings-search">
        <span className="visually-hidden">Find a setting</span>
        <input
          autoComplete="off"
          id="settings-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Find a setting…"
          type="search"
          value={query}
        />
      </label>
      {searching && (
        <ul aria-live="polite" className="settings-search-hits">
          {hits.length === 0 ? (
            <li className="subtle">Nothing by that name.</li>
          ) : (
            hits.map((hit) => (
              <li key={hit.key}>
                <a href={hit.href} onClick={() => setQuery('')}>
                  {hit.label}
                </a>{' '}
                <span className="subtle">{hit.where}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
