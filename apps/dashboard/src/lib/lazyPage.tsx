// Screens loaded when they are first opened, not with the app (2026-11-24).
//
// Until then App.tsx imported all forty screens up front, so the sign-in page
// downloaded the hive editor, the map and the shop tables before it could draw
// a form. Each screen is now its own file in dist/assets/, fetched the first
// time somebody opens it.
//
// THE RELEASE PROBLEM. A tab opened before a release still holds the old
// index-*.js, which names the old chunk files; Cloudflare serves only the new
// release's files, so the first screen that tab opens after the release fails
// to load. The fix is the one the user would reach for: reload, which fetches
// the new index.html. Once only — a chunk that is missing from the CURRENT
// release too would otherwise reload forever — and then the boundary below
// says so instead of leaving a white page.

import { Component, type ComponentType, type ReactNode, Suspense, lazy } from 'react';
import { useT } from './i18n';

const RELOADED_AT = 'dw:chunk-reload-at';
/** A second failure within this long of the reload is not a stale tab. */
const RELOAD_WINDOW_MS = 30_000;

/** Reload the page unless this tab just did so for the same reason. Returns
 * whether it reloaded. */
export function reloadOnceForStaleChunk(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  now: number,
  reload: () => void,
): boolean {
  // Without a record of the reload, a second failure would reload again: loop.
  if (storage === null) return false;
  try {
    const last = Number(storage.getItem(RELOADED_AT) ?? 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOADED_AT, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** `lazy` for a named export: `lazyPage(() => import('./X').then((m) => m.XPage))`. */
// biome-ignore lint/suspicious/noExplicitAny: the props are the component's own; React.lazy needs this shape
export function lazyPage<C extends ComponentType<any>>(load: () => Promise<C>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch (error) {
      if (reloadOnceForStaleChunk(sessionStore(), Date.now(), () => window.location.reload())) {
        // The page is going away; never resolve, so nothing flashes first.
        return new Promise<{ default: C }>(() => undefined);
      }
      throw error;
    }
  });
}

interface BoundaryState {
  failed: boolean;
}

/** What a screen that could not be loaded shows instead of a white page. */
class PageLoadBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <PageFailed />;
  }
}

/** A function component so it can use the reader's language; the boundary
 * itself has to be a class. No <main> of its own: some screens are drawn
 * inside App's. */
function PageFailed() {
  const t = useT();
  return (
    <section aria-labelledby="page-failed-heading">
      <h2 id="page-failed-heading">{t('This page did not load')}</h2>
      <p className="empty" role="alert">
        {t('The connection dropped, or the site was updated while this tab was open.')}{' '}
        <button className="link-button" onClick={() => window.location.reload()} type="button">
          {t('Reload')}
        </button>
      </p>
    </section>
  );
}

/** The line a screen shows while its data or its code is on the way. */
export function Loading() {
  const t = useT();
  return <p className="empty loading">{t('Loading…')}</p>;
}

/** Around every routed screen: a loading line while its file arrives, and the
 * boundary if it never does. Keyed by the route so that leaving a failed screen
 * for another one tries again. */
export function PageSlot({ children, route }: { children: ReactNode; route: string }) {
  return (
    <PageLoadBoundary key={route}>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </PageLoadBoundary>
  );
}
