import { LegalPage } from './LegalPage';

/** What somebody agrees to by signing in.
 *
 * Written for what this dashboard ACTUALLY IS — a private tool one person runs
 * for one alliance — rather than copied from a template written for a company
 * with users. The two differ in the places that matter: there is no paid tier,
 * no company behind it, no promise of uptime, and access is granted by an
 * invitation code rather than by signing up.
 *
 * Kept in sync by hand with the Privacy Policy's account section and with
 * `leave_alliance()` (0094): "leaving removes the alliance row, not the login"
 * is a fact about that function, and if it changes both pages are wrong.
 */
export function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="16 August 2026">
      <p>
        This dashboard is a private, non-commercial tool built for the members of the HELLBOUND
        [CBFW] alliance on Dark War Survival server group 577–584. By signing in you agree to what
        is written here. If you do not, do not sign in.
      </p>

      <h3>Not affiliated with the game</h3>
      <p>
        This is an unofficial, fan-made tool. It is not made, endorsed, sponsored or supported by
        the publisher or developer of Dark War Survival. Game names, ranks and figures shown here
        belong to their respective owners and are used only to describe what was observed in the
        game.
      </p>

      <h3>Who may use it</h3>
      <p>
        Anyone can create an account, but an account on its own shows you nothing. Access to the
        alliance's screens is granted by an invitation code from an alliance administrator, and can
        be withdrawn by one. Use one account per person, keep your password to yourself, and tell an
        administrator if you think somebody else has got into your account.
      </p>

      <h3>What you post</h3>
      <p>
        Notices, guides, comments and images you write stay yours. By posting them you allow this
        dashboard to store them, show them to other members, and — for notices — republish them to
        the alliance's Discord channel, which is what the notice board is for. Anything you publish
        to Discord leaves this dashboard and is subject to Discord's own terms.
      </p>
      <p>
        A post can outlive your membership. If you leave, your posts remain and are shown without an
        author's name rather than deleted, because other members' guides and replies depend on them.
        Ask an administrator if you want something you wrote taken down.
      </p>

      <h3>What you may not do</h3>
      <ul>
        <li>Post anything illegal, threatening, or harassing towards another member.</li>
        <li>
          Upload another person's real-world personal information — a real name, address, phone
          number, workplace, or a photograph of them — with or without their agreement.
        </li>
        <li>
          Try to reach data you have not been granted: probing the database directly, reusing
          somebody else's session, or sharing an invitation code outside the alliance.
        </li>
        <li>
          Automate bulk access. Read the screens; do not script them. The figures here were
          expensive to collect and the database they come from is small.
        </li>
        <li>Republish alliance-internal figures outside the alliance.</li>
      </ul>

      <h3>The figures are observations, not records</h3>
      <p>
        Everything on the ranking, arena and member screens is a snapshot of what the game showed at
        a particular moment, captured by a collector that is not always running. Figures can be
        stale, incomplete, or wrong. Nothing here is authoritative — the game is. Do not use this
        dashboard as the sole basis for a decision that matters to somebody.
      </p>

      <h3>No promises about availability</h3>
      <p>
        This is a personal project run by one person on a small hosted database. It may be slow,
        broken, or switched off, with or without notice, and no data here is guaranteed to survive.
        Keep your own copy of anything you would miss.
      </p>

      <h3>Ending your access</h3>
      <p>
        You can leave from your account page at any time; doing so removes your alliance membership
        and role, and leaves your login able to sign back in as a stranger. An administrator can
        revoke access for breaking these terms, or for leaving the alliance in the game. To have the
        login itself deleted, ask — see the Privacy Policy.
      </p>

      <h3>No warranty, and limited liability</h3>
      <p>
        The dashboard is provided as it is, with no warranty of any kind. To the extent the law
        allows, its operator is not liable for any loss arising from using it, from figures shown on
        it being wrong, or from it being unavailable.
      </p>

      <h3>Changes</h3>
      <p>
        These terms can change. The date at the top says when they last did. Continuing to sign in
        after a change means accepting the new version.
      </p>

      <h3>Governing law and contact</h3>
      <p>
        These terms are governed by the laws of the Republic of Korea. For anything about this page,
        write to <a href="mailto:hjyshane@gmail.com">hjyshane@gmail.com</a>, or ask an administrator
        in the alliance's Discord.
      </p>
    </LegalPage>
  );
}
