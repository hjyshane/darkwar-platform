// The static copies at /terms and /privacy must say exactly what the React
// pages say.
//
// WHY THEY EXIST AT ALL. The dashboard's own addresses are `#/terms` and
// `#/privacy`, and a hash fragment is never sent to the server: a checker that
// does not run JavaScript fetches those URLs and receives the empty SPA shell.
// Google's and Discord's OAuth verification fetch exactly those URLs. So the
// same prose is also served as flat HTML from `public/`, which Vite copies into
// `dist/` verbatim and the Worker serves directly.
//
// WHY THIS TEST. Two copies of a legal document is the kind of duplication that
// rots quietly — the React page gets amended, the flat file keeps last year's
// promises, and nobody looks at the flat file again because nobody in the
// alliance ever visits it. Comparing the rendered text word for word is what
// makes the duplication safe.
//
// TO REGENERATE after editing a React page, render it and re-wrap it — do not
// hand-edit `public/`:
//
//   renderToStaticMarkup(<TermsPage />)   // react-dom/server
//
// then paste into `public/terms/index.html` between the <body> tags, rewriting
// `#/terms` -> `/terms`, `#/privacy` -> `/privacy`, `#/login` -> `/#/login`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PrivacyPage } from '../src/features/legal/PrivacyPage';
import { TermsPage } from '../src/features/legal/TermsPage';

/** Whitespace is not content. JSX writes newlines and indentation that the
 *  wrapper reflows, and neither is something a reader sees. */
function words(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Resolved from the working directory rather than from `import.meta.url`.
 *
 * Under the jsdom environment `import.meta.url` is an http address, not a file
 * one, so `fileURLToPath` on it yields `C:\public\...` — a path that does not
 * exist, failing with ENOENT rather than with anything that explains itself.
 * Vitest runs with the package as its root, which is where `public/` is. */
function staticPage(name: 'terms' | 'privacy'): Document {
  // `terms.html`, NOT `terms/index.html`. Both are reachable, but the Worker's
  // default `auto-trailing-slash` handling serves a directory only at
  // `/terms/` and answers `/terms` with a 307 to it. A flat file inverts that:
  // `/terms` is a 200 and `/terms/` is the redirect. The URL handed to Google
  // and Discord should be the one that answers directly — a verification
  // checker that does not follow redirects sees a 307 as a failure.
  const path = resolve(process.cwd(), 'public', `${name}.html`);
  return new DOMParser().parseFromString(readFileSync(path, 'utf8'), 'text/html');
}

describe.each([
  { name: 'terms' as const, Page: TermsPage, heading: 'Terms of Service' },
  { name: 'privacy' as const, Page: PrivacyPage, heading: 'Privacy Policy' },
])('$name', ({ name, Page, heading }) => {
  test('the flat file says exactly what the React page says', () => {
    const { container } = render(<Page />);
    const rendered = words(container.textContent ?? '');
    const flat = words(staticPage(name).body.textContent ?? '');

    // Not `toContain`. A policy that has gained a paragraph in one copy and not
    // the other is the failure this is here to catch, and containment would
    // pass for it in one direction.
    expect(flat).toBe(rendered);
  });

  test('it stands on its own with no script', () => {
    const document_ = staticPage(name);

    // The point of the file. A <script> here would mean the checker that
    // cannot run JavaScript is back to seeing nothing.
    expect(document_.querySelectorAll('script').length).toBe(0);
    expect(document_.querySelector('h2')?.textContent).toBe(heading);
    // Inline, because the app's stylesheet is hashed at build time and this
    // file cannot know its name.
    expect(document_.querySelectorAll('style').length).toBe(1);
  });

  test('its links are real paths rather than the app hashes', () => {
    // `#/privacy` from `/terms` sets a fragment and leaves the reader where
    // they are. The SPA's addresses cannot be copied across unchanged.
    const hrefs = [...staticPage(name).querySelectorAll('.legal-links a')].map((a) =>
      a.getAttribute('href'),
    );

    expect(hrefs).toEqual(['/terms', '/privacy', '/#/login']);
  });
});
