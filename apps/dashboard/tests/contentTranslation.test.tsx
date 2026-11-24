import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useContentTranslation } from '../src/lib/contentTranslation';

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({ data: { body: '번역' }, error: null })),
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useContentTranslation', () => {
  it('drops a translation when the text it came from changes (codex review on #677)', async () => {
    const { result, rerender } = renderHook(
      ({ id, source }) => useContentTranslation('comment', id, source),
      { wrapper, initialProps: { id: 'c1', source: 'see you saturday' } },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ body: '번역' }));

    // The same comment, edited: the old translation must not stay on screen.
    rerender({ id: 'c1', source: 'see you sunday' });
    await waitFor(() => expect(result.current.data).toBeUndefined());

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.data).toEqual({ body: '번역' }));

    // Another post opened in the same page.
    rerender({ id: 'c2', source: 'see you sunday' });
    await waitFor(() => expect(result.current.data).toBeUndefined());
  });
});
