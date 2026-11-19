import { PlayerClaimForm } from './PlayerClaimForm';

/** The screen an alliance account sees until it says which character it is.
 *
 * Shown in place of whatever page was asked for (lib/characterGate.ts), and the
 * address is left alone: once a character is linked, `PlayerClaimForm`
 * invalidates every query, the session comes back with a `playerId`, and the
 * page that was asked for renders where this was. No redirect to undo.
 *
 * No sidebar around it — nothing in it would open — but the header keeps the
 * sign-out button, so somebody who cannot find their character is not stuck.
 */
export function CharacterGate() {
  return (
    <main>
      <section aria-labelledby="character-gate-heading" className="signin-card">
        <h2 id="character-gate-heading">Which character are you?</h2>
        <p>
          Pick your in-game character to open the dashboard. Your account is shown as that
          character, and your own pages (planner, activity) follow it.
        </p>
        <PlayerClaimForm />
        <p className="empty">
          Not on the list? The collector may not have seen you yet, or you joined recently — ask an
          officer to check the roster.
        </p>
      </section>
    </main>
  );
}
