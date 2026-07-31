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
export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
