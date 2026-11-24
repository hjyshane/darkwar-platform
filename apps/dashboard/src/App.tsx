import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { AllianceSwitcher } from './components/AllianceSwitcher';
import { EditModeToggle } from './components/EditModeToggle';
import { LanguagePicker } from './components/LanguagePicker';
import { RefreshButton } from './components/RefreshButton';
import { ReplyAlerts } from './components/ReplyAlerts';
import { SignOutButton } from './components/SignOutButton';
import { SyncStatus } from './components/SyncStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { PreviewBanner } from './components/ViewAs';
import { AppShell } from './components/shell/AppShell';
import { CharacterGate } from './features/auth/CharacterGate';
import { LoginPage } from './features/auth/LoginPage';
import { isAlliancePinnedByHost } from './lib/activeAlliance';
import { useRecordActivity } from './lib/activity';
import { mustPickCharacter, openWhilePicking } from './lib/characterGate';
import { communityMayOpen } from './lib/communityAccess';
import { EditModeProvider } from './lib/editMode';
import { LanguageProvider, useT } from './lib/i18n';
import { Loading, PageSlot } from './lib/lazyPage';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import { useReplyAlerts } from './lib/replyAlerts';
import { rememberReturnTo } from './lib/returnTo';
import {
  RANKING_TABS,
  type Route,
  allianceIdFromHash,
  isRankingRoute,
  isStandaloneRoute,
  routeFromHash,
} from './lib/route';
import { supabase } from './lib/supabase';
import { useMayView } from './lib/useMayView';
import { useActiveAlliance } from './lib/useMyAlliances';
import { useSession } from './lib/useSession';
import { useSidewaysMouse } from './lib/useSidewaysMouse';
import { RoutePage } from './pages';

function DataChangeSubscriber() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeDataChanges(supabase, (topic) => {
        for (const queryKey of queryKeysForTopic(topic)) {
          void queryClient.invalidateQueries({ queryKey: [...queryKey] });
        }
      }),
    [queryClient],
  );
  // Signing in or out changes which JWT the queries carry, and therefore
  // what RLS lets them see — every cached answer is stale at that moment.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void queryClient.invalidateQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);
  return null;
}

// Exported only so the local look-around build (src/dev) can seed it before
// render. Nothing in the app reads it from outside this file.
//
// The defaults matter more here than they would elsewhere, because the
// database is in us-east-2 and the readers are not. Measured against
// production: a request that does no work at all — one row out of `servers` —
// takes 101-189 ms. Distance, not work, is what a screen costs now that 0098
// and 0099 have fixed the plans, and the cheapest request is the one that
// never leaves.
//
// `new QueryClient()` bare meant staleTime 0: every navigation refetched
// everything it had just fetched. Members -> Rankings -> Members asked the
// same questions three times.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A minute of trust. Nothing here is a live figure — the collector
      // writes in bursts a minute or more apart, and a snapshot that is 60
      // seconds old is the same snapshot.
      //
      // Safe to be this long ONLY because FR-UI-005 already exists: the UI
      // subscribes to data_change_notifications and maps topics to query
      // keys (lib/realtime.ts), so a new capture invalidates the keys it
      // affects immediately. Staleness here is a floor on how often we ask
      // unprompted, not a ceiling on how fresh the screen can be.
      staleTime: 60_000,
      // Kept longer than staleTime so going back to a screen shows its last
      // answer at once and revalidates behind it, rather than blanking.
      gcTime: 10 * 60_000,
      // Off, for the same reason. Realtime already says when something
      // changed; refocusing a tab is not evidence that anything did, and on
      // this connection each refetch is another 150 ms per query. There is a
      // "Refetch this screen's data" button for when the reader disagrees.
      refetchOnWindowFocus: false,
      // Three tries with backoff turns one slow failure into four. The
      // screens here already render a refusal rather than a crash — a 42501
      // is an answer, not an error — so retrying mostly delays the message.
      retry: 1,
    },
  },
});

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The three boards behind Rankings, as a row inside the screen.
 *
 * The sidebar lists every screen once, so the old second rows are gone; this is
 * the one that is not a list of screens but of boards of one screen, and it
 * belongs with the content it switches. Arena needs `arena.view` (0064): this
 * hides a tab and withholds nothing, and an undefined answer is "not yet", not
 * "no". */
function RankingBoards({ route }: { route: Route }) {
  const mayViewArena = useMayView('arena.view');
  const tabs = RANKING_TABS.filter((tab) => tab.route !== 'arena' || mayViewArena === true);
  if (!isRankingRoute(route) || tabs.length < 2) {
    return null;
  }
  return (
    <nav aria-label="Board" className="tabs subtabs">
      {tabs.map((tab) => (
        <a
          key={tab.hash}
          aria-current={tab.route === route ? 'page' : undefined}
          className="tab"
          href={tab.hash}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/** The account link, with a dot when somebody is waiting on you.
 *
 * A DOT RATHER THAN A COUNT. The banner below already lists them and says how
 * many; this only has to answer "is there anything", which is the question
 * somebody glancing at the header is asking. A number here would be a second
 * place to keep the same figure correct.
 *
 * It reads the same unread query the banner does, so the two cannot disagree —
 * and clearing one clears the other.
 */
function AccountLink() {
  const { data: alerts } = useReplyAlerts();
  const t = useT();
  const waiting = (alerts ?? []).length > 0;
  return (
    <a className="header-link" href="#/account">
      {t('My account')}
      {waiting && (
        // Named for a screen reader, since a coloured dot says nothing to one.
        <span aria-label={t('You have unread replies')} className="header-dot" role="status" />
      )}
    </a>
  );
}

/** The alliance toggle, for admins only (decided 2026-09-29).
 *
 * Everybody else sees the one alliance they belong to. It used to show for
 * anybody in two alliances as well; nobody but an admin is, and the rule is
 * that an account lives in its own alliance. The database is the boundary
 * either way — active_alliance() never honours an alliance the caller is not
 * in — so this is about what the header offers, not what can be read. */
function HeaderAllianceSwitcher() {
  const { data: session } = useSession();
  const { alliances, active, switchTo } = useActiveAlliance();
  if (session?.role !== 'admin' || isAlliancePinnedByHost()) {
    return null;
  }
  return (
    <AllianceSwitcher
      alliances={alliances}
      activeId={active?.alliance_id ?? null}
      onSwitch={switchTo}
    />
  );
}

// `community` (0282) passes the wall: it is signed in and admitted. What it may
// open is `communityMayOpen`, applied to the page below.
const MEMBER_ROLES = new Set(['community', 'member', 'officer', 'admin']);

export function App() {
  // Once, for every table on every screen. See the hook: it is delegated off
  // `.table-wrap`, so a table added later needs nothing.
  useSidewaysMouse();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const route = routeFromHash(hash);
  // Where to come back to after signing in is recorded in `Shell`, not here:
  // it depends on whether the reader was actually stopped by the wall, and the
  // session query that answers that only exists inside the provider below.
  // The page itself reads the ids it needs from the address (pages.tsx); the
  // shell needs only the alliance, to mark our own alliance's entry current.
  const allianceId = allianceIdFromHash(hash);
  // No tab bar, and no wall — see `isStandaloneRoute` for why each of the four
  // is on that list. A server page is NOT: it is reached FROM the tabs, and
  // taking the way back away would strand the reader.
  const standalone = isStandaloneRoute(route);
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <EditModeProvider>
          <Shell allianceId={allianceId} hash={hash} route={route} standalone={standalone} />
        </EditModeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function Shell({
  route,
  allianceId,
  standalone,
  hash,
}: {
  route: Route;
  allianceId: string | null;
  standalone: boolean;
  /** The raw hash, only so the wall can remember what was asked for. */
  hash: string;
}) {
  // Inside the provider, because it is a query. Undefined means "not
  // answered yet" and must not be read as "not a member" — flashing the
  // wall at a member on every load would be worse than a beat of Loading.
  const { data: session, isPending } = useSession();
  const isMember = session !== undefined && MEMBER_ROLES.has(session.role);
  const isCommunity = session?.role === 'community';
  const walled = !standalone && !isPending && !isMember;
  // A member or officer with no character linked sees the picker in place of
  // every page but sign-in and the legal two (lib/characterGate.ts).
  const mustPick = mustPickCharacter(session);
  const picking = mustPick && !openWhilePicking(route);

  // Only what the wall actually refused. `walled` is in the dependencies as
  // well as `hash` because a session can expire without the reader touching
  // anything — at that moment the page they are sitting on becomes the page
  // they need bringing back to, and no hash change is coming to notice it.
  useEffect(() => {
    rememberReturnTo(hash, walled);
  }, [hash, walled]);

  // EVERYONE IN THE ALLIANCE LANDS ON HOME (owner, 2026-11-18): opening the
  // site with no address goes there. Only the EMPTY address — `#/` is still
  // the overview, so the sidebar's Overview entry and every link sent to it
  // keep working. A community account keeps the overview: Home is ours.
  useEffect(() => {
    if (isMember && !isCommunity && (hash === '' || hash === '#')) {
      window.location.replace('#/home');
    }
  }, [hash, isMember, isCommunity]);

  // Signing in scores a point, once a day (0114). Here rather than in the
  // login form, because most sessions do not pass through that form at all —
  // the token is restored from storage and the member simply arrives. What is
  // being counted is "showed up today", which is exactly this moment.
  useRecordActivity('login');

  // The controls that sat in the title row. They keep their own behaviour; the
  // shell only decides where they go.
  const controls = (
    <>
      <HeaderAllianceSwitcher />
      {/* In the bar rather than on a panel: it is about the whole board, not one
          table's data. Only for members: it reads sync_status, which 0065
          closed like everything else. */}
      {isMember && !isCommunity && !mustPick && <SyncStatus />}
      {isMember && !isCommunity && !mustPick && <RefreshButton />}
      {isMember && !mustPick && <AccountLink />}
      {/* Signing out was only reachable from the login screen, which is the one
          place somebody already signed in has no reason to visit. It is here for
          anybody with a session, including a signed-in non-member looking at
          the wall, who otherwise has no way out of it at all. */}
      {session?.email != null && <SignOutButton email={session.email} />}
      <EditModeToggle />
      <ThemeToggle />
      {/* After the theme toggle, whose auto margin pushes the pair to the right. */}
      <LanguagePicker />
    </>
  );
  // No sidebar while a character is owed: every entry in it would open the
  // picker again.
  const inShell = !standalone && isMember && !mustPick;

  // THE WALL IS GONE. It said "Alliance members only" and offered a link to the
  // sign-in page: one screen whose entire content was a signpost to another.
  // Sending them straight to the sign-in page loses nothing: it carries the
  // Terms and Privacy links the wall carried, and it handles the second state
  // the wall existed for (signed in with no role yet) far better, by putting the
  // join-code box in front of them.
  const page = walled ? (
    <LoginPage />
  ) : isPending && !standalone ? (
    <main>
      <Loading />
    </main>
  ) : picking ? (
    <CharacterGate />
  ) : isCommunity && !communityMayOpen(route) ? (
    // The pages that are about the alliance, and the player, alliance and
    // server pages the ranking rows link to (they list our roster).
    <main>
      <section aria-labelledby="community-closed-heading">
        <h2 id="community-closed-heading">Not available</h2>
        <p className="empty">
          This page is for alliance members. Your account can open the overview, rankings,
          migration, map, calculator, game calendar, event guide and shop value, and other
          alliances' and players' pages. <a href="#/">Back to the overview</a>
        </p>
      </section>
    </main>
  ) : (
    <RoutePage hash={hash} route={route} />
  );

  return (
    <>
      <DataChangeSubscriber />
      <PreviewBanner />
      {inShell ? (
        <AppShell allianceId={allianceId} controls={controls} hash={hash} route={route}>
          {/* Above whatever screen the reader came for, because the whole problem
              it solves is that the answer is somewhere they are not (0117). */}
          <ReplyAlerts />
          <RankingBoards route={route} />
          <PageSlot route={route}>{page}</PageSlot>
        </AppShell>
      ) : (
        <>
          <header className="app-header">
            <h1>
              <a className="app-home" href="#/">
                Dark War dashboard
              </a>
              {controls}
            </h1>
          </header>
          <PageSlot route={route}>{page}</PageSlot>
        </>
      )}
    </>
  );
}
