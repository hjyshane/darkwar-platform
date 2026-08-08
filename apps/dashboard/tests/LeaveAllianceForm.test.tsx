// Leaving is one RPC and one confirmation. The tests are about what the
// screen does with the two answers it can get back, because the refusal —
// the last admin — is the only message here that tells the reader what to
// do next, and swallowing it would leave them pressing a button that
// silently does nothing.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { LeaveAllianceForm } from '../src/features/auth/LeaveAllianceForm';
import { supabase } from '../src/lib/supabase';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LeaveAllianceForm />
    </QueryClientProvider>,
  );
}

test('one click asks, it does not leave', async () => {
  // The other button on this screen says "Sign out". A single click that
  // gave up access would be one misclick away from the wrong outcome.
  const rpc = vi.spyOn(supabase, 'rpc');
  renderForm();

  fireEvent.click(screen.getByRole('button', { name: 'Leave the alliance' }));

  expect(rpc).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Yes, leave the alliance/ })).toBeDefined();
});

test('the confirmation says what survives, because most of it does', async () => {
  renderForm();
  fireEvent.click(screen.getByRole('button', { name: 'Leave the alliance' }));

  const explanation = screen.getByText(/Leaving takes away your access/);
  expect(explanation.textContent).toContain('invitation code lets you back in');
});

test('cancelling leaves nothing called', async () => {
  const rpc = vi.spyOn(supabase, 'rpc');
  renderForm();

  fireEvent.click(screen.getByRole('button', { name: 'Leave the alliance' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(rpc).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Leave the alliance' })).toBeDefined();
});

test('the second click calls leave_alliance and nothing else', async () => {
  // Never a direct write to app_users: that table is gated on
  // members.manage, which the person leaving does not have, so a form that
  // tried it would fail for everybody it is meant for.
  const rpc = vi
    .spyOn(supabase, 'rpc')
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
    .mockResolvedValue({ data: null, error: null } as any);
  renderForm();

  fireEvent.click(screen.getByRole('button', { name: 'Leave the alliance' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes, leave/ }));

  await waitFor(() => expect(rpc).toHaveBeenCalledWith('leave_alliance'));
  await screen.findByText(/You are signed in as a viewer now/);
});

test('the last-admin refusal is shown, not swallowed', async () => {
  // 0094 raises 23514 with the instruction attached. Replacing it with a
  // generic "could not leave" would drop the only sentence that says how to
  // get out of the situation.
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: { message: 'the last admin cannot leave; make somebody else an admin first' },
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);
  renderForm();

  fireEvent.click(screen.getByRole('button', { name: 'Leave the alliance' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes, leave/ }));

  const refusal = await screen.findByText(/last admin cannot leave/);
  expect(refusal.className).toBe('error');
  expect(refusal.textContent).toContain('make somebody else an admin first');
});
