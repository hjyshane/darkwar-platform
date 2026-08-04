import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/** Render a component that reads session or favourites.
 *
 * Those hooks are react-query, so the table components need a provider even
 * when a test only cares about the markup. Retries are off: a failing query
 * should surface immediately rather than after backoff, and nothing here
 * benefits from a second attempt.
 *
 * `seed` fills the cache before the render, the same way `dev/fixtures.ts`
 * does for the look-around build. Without it a test can only ever see what a
 * component draws with every query unanswered, which is why the arena's
 * grades were asserted as all-dashes for months: no catalogue was seeded, so
 * the case where a grade EXISTS had no coverage at all. Optional, so the
 * existing call sites keep meaning what they meant.
 */
export function renderWithQuery(ui: ReactNode, seed?: [readonly unknown[], unknown][]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  for (const [key, value] of seed ?? []) {
    client.setQueryData(key, value);
  }
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
