// A local build for LOOKING at the dashboard. Not a test, not verification.
//
// It renders the real App — real routing, real components, real stylesheet —
// with the query cache filled in first, so there is no backend to run. This
// Mac has no Docker, so no Supabase stack; the alternative was a mock
// PostgREST, which is what the previous Mac session did and what
// .claude/skills/run-dashboard records as having hidden two bugs for weeks.
//
// What this CANNOT tell you: whether a query is correct, whether RLS allows
// it, whether a column grant exists, whether PostgREST returns what the
// component expects. Every one of those is bypassed here by construction.
// It tells you what the screens look like. That is all it is for.
import { Component, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, queryClient } from '../App';
import '../index.css';
import { FIXTURES } from './fixtures';

/** Dev-only. A fixture of the wrong shape throws inside a component and
 * React unmounts the whole tree, so the symptom is a white page with the
 * cause only in a console warning. That cost ten minutes once; this makes it
 * say which component and why.
 *
 * Deliberately NOT added to the real app — whether production should have a
 * boundary is a separate question and not one to answer by side effect. */
class DevBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <main>
        <section>
          <h2>A fixture is the wrong shape</h2>
          <p className="error">{error.message}</p>
          <pre className="shape">{error.stack}</pre>
          <p className="subtle">
            This is the local look-around build. Fix <code>src/dev/fixtures.ts</code> — the app
            itself is not necessarily at fault.
          </p>
        </section>
      </main>
    );
  }
}

// staleTime Infinity plus refetchOnMount false means a seeded key never
// asks the network. Keys with no fixture still will, fail, and land on the
// screen's own error state — which is honest: it says the fixture is
// missing rather than inventing an answer.
queryClient.setDefaultOptions({
  queries: {
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
});

for (const [key, value] of FIXTURES) {
  queryClient.setQueryData(key, value);
}

// Two queries set their own refetchInterval (the header's sync badge and the
// collector table, both 20s). A call-site option beats a default, so after
// twenty seconds those two try the network and fail. The badge keeps its
// data and only logs; the collector table adds a red line. Left alone rather
// than papered over — pretending the network succeeded is how a mock starts.
const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root element missing from index.dev.html');
}
createRoot(root).render(
  <StrictMode>
    <DevBoundary>
      <App />
    </DevBoundary>
  </StrictMode>,
);
