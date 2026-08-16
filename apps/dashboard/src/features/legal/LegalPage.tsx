import type { ReactNode } from 'react';

/** The frame the two legal pages share.
 *
 * BOTH ARE PUBLIC, and that is the whole reason this exists as its own screen
 * rather than a section of the account page. Google and Discord will not
 * approve an OAuth application whose terms and privacy URLs sit behind a login
 * — the reviewer fetches them signed out — and neither will a person deciding
 * whether to hand this dashboard their email address. So `route.ts` lists them
 * and `App.tsx` marks them standalone, which is what carries them past the
 * members-only wall.
 *
 * Standalone also means no tab bar, which is correct for a second reason: a
 * signed-out reader has no tabs, and drawing an empty nav above a legal page
 * would be furniture.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** The date the text last changed, written out. Not derived from the build:
   *  a redeploy is not an amendment, and a date that moves on its own tells a
   *  reader something untrue about when the terms changed. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="legal">
      <section aria-labelledby="legal-heading">
        <h2 id="legal-heading">{title}</h2>
        <p className="legal-updated">Last updated: {updated}</p>
        {children}
        {/* Every way back out, in one place. A reader arrives here from the
            sign-in page, from the wall, or from a link somebody sent them —
            the third of those has no history to go back through. */}
        <nav aria-label="Related" className="legal-links">
          <a href="#/terms">Terms of Service</a>
          <a href="#/privacy">Privacy Policy</a>
          <a href="#/login">Sign in</a>
        </nav>
      </section>
    </main>
  );
}
