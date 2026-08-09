import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/** Render a component that reads session or favourites.
 *
 * Those hooks are react-query, so the table components need a provider even
 * when a test only cares about the markup. Retries are off: a failing query
 * should surface immediately rather than after backoff, and nothing here
 * benefits from a second attempt.
 */
export function renderWithQuery(ui: ReactNode, seed: readonly SeedEntry[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Answers those hooks would otherwise fetch. Seeding the cache is how a test
  // says "this reader is an officer" without mocking the module: the component
  // reads the same useSession it always does, and gets a cached answer instead
  // of a network one. Without this the role is undefined for the whole
  // synchronous render, which is a fine default but only tests one reader.
  for (const [key, data] of seed) {
    client.setQueryData(key, data);
  }
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

type SeedEntry = readonly [key: readonly unknown[], data: unknown];
