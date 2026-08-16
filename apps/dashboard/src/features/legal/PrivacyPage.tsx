import { LegalPage } from './LegalPage';

/** What is stored, why, and who else sees it.
 *
 * THIS PAGE IS A CLAIM ABOUT THE SCHEMA, so it is written from the schema
 * rather than from a template. Every list below names something that actually
 * exists: `app_users`, `player_claims`, `favourites`, `post_reads`,
 * `activity_events`, `audit_logs`, `join_code_attempts`, the private
 * `post-images` bucket. A generic privacy policy would be shorter and would be
 * a lie in both directions — claiming collection that does not happen, and
 * omitting the two things here that a reader would not guess: the daily
 * activity record, and that this dashboard holds observed figures about people
 * who never signed up for it.
 *
 * If a table is added that holds something about a person, it belongs here.
 */
export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="16 August 2026">
      <p>
        This dashboard is run by one person for the HELLBOUND [CBFW] alliance. It is not a business,
        it sells nothing, and it has no advertising. Nothing collected here is sold, rented, or
        handed to anyone for marketing.
      </p>

      <h3>What is stored about you when you sign in</h3>
      <ul>
        <li>
          <strong>Your email address.</strong> Either the one you typed, with a password that is
          stored hashed and never in readable form, or the address your Google or Discord account
          reports if you sign in with one of those. Signing in with a provider hands over your email
          address and an account identifier — nothing else. No contacts, no files, no friend list,
          no posting on your behalf.
        </li>
        <li>
          <strong>Your role and alliance membership</strong> — viewer, member, officer or admin, and
          an optional display name.
        </li>
        <li>
          <strong>Which in-game character you claim to be</strong>, once you pick one, and who
          approved that claim.
        </li>
        <li>
          <strong>What you write</strong>: notices, guides, comments, and any images you upload.
        </li>
        <li>
          <strong>Your own lists</strong>: which players you have starred, which posts you have
          read, and how the tables are arranged for you.
        </li>
        <li>
          <strong>A daily activity record</strong>: the days on which you signed in, posted, or
          commented. Days, not times or page visits. It exists so the alliance can see who is taking
          part, and other members can see it.
        </li>
        <li>
          <strong>Administrative actions</strong>: if you are an administrator, the changes you make
          are recorded with your account against them. Failed invitation-code attempts are also
          counted, to stop codes being guessed.
        </li>
      </ul>

      <h3>What is not collected</h3>
      <p>
        No analytics, no advertising or tracking cookies, no third-party scripts that report your
        visit to anyone, no location, no payment details, no device fingerprinting. There is no
        record of which screens you look at or how long you stay on them.
      </p>

      <h3>Data about in-game players</h3>
      <p>
        Most of what this dashboard shows is not about its users at all. It holds observations of
        the game's own public ranking, alliance and arena boards for servers 577–584: character
        names, power, kills, alliance, headquarters level, rank and similar figures, recorded over
        time so trends can be drawn. These are captured from the game by a collector run on the
        operator's own PC.
      </p>
      <p>
        This includes players who have never signed in here and are not members of the alliance.
        What is stored is game-account information — the same figures any player can read from the
        in-game boards — and not real-world identity. Raw network captures stay on the operator's
        machine, are never published, and are not part of this dashboard.
      </p>
      <p>
        If you are one of those players and want your figures removed, write to the address below.
      </p>

      <h3>Who else sees it</h3>
      <ul>
        <li>
          <strong>Other alliance members.</strong> Everything on these screens is visible to signed-
          in members of the alliance. Treat this as a room your alliance is in, not a private
          notebook.
        </li>
        <li>
          <strong>Supabase</strong> hosts the database, the sign-in system and uploaded images. The
          database is in the United States.
        </li>
        <li>
          <strong>Cloudflare</strong> serves this page.
        </li>
        <li>
          <strong>Discord</strong>, when a notice is published to the alliance channel — the notice
          and any images in it are sent there — and when you choose to sign in with Discord.
        </li>
        <li>
          <strong>Google</strong>, only if you choose to sign in with Google.
        </li>
      </ul>
      <p>
        Nobody else. Data would be disclosed further only if the law required it, and the operator
        holds nothing of interest to anyone who is not in the alliance.
      </p>

      <h3>What is kept in your browser</h3>
      <p>
        Your sign-in token, so you stay signed in; your light or dark theme choice; and how you have
        arranged the tables. All of it is local storage in your own browser, not tracking cookies,
        and clearing your browser data removes it.
      </p>

      <h3>How it is protected</h3>
      <p>
        Every table refuses to answer a request that is not entitled to it — the database enforces
        this itself, not just the screens, so an address typed by hand gets nothing a signed-out
        reader could not already see. Uploaded images sit in a private bucket and are served through
        short-lived links to signed-in members only.
      </p>

      <h3>How long it is kept</h3>
      <p>
        Observed game figures are kept indefinitely: their whole purpose is history, and deleting
        last month erases the trend. Your posts and comments stay until removed. Leaving the
        alliance removes your membership, role and display name, and detaches your character claim;
        it leaves your login able to sign in again, and leaves your starred players and read marks
        in place so rejoining does not mean starting over.
      </p>

      <h3>Your choices</h3>
      <p>
        You can ask what is held about you, ask for it to be corrected, or ask for your login and
        everything tied to it to be deleted outright. Deletion of the login itself is done by hand,
        so allow a few days. Leaving the alliance is something you can do yourself, at any time,
        from your account page.
      </p>

      <h3>Children</h3>
      <p>This dashboard is not intended for anyone under 14.</p>

      <h3>Changes and contact</h3>
      <p>
        This policy can change; the date at the top says when it last did. For anything about it —
        including a request to see or delete your data — write to{' '}
        <a href="mailto:hjyshane@gmail.com">hjyshane@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
