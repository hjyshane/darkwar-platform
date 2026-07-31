// The form must not soften what the database says. redeem_join_code()
// reports every failure identically on purpose — wrong, expired, revoked,
// exhausted — so anything the UI adds risks inventing a distinction the
// server refuses to make.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { JoinCodeForm } from '../src/features/auth/JoinCodeForm';
import { supabase } from '../src/lib/supabase';

test('a rejected code shows the server message verbatim', async () => {
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: { message: 'that code is not valid' },
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'NOPE' } });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(screen.getByText('that code is not valid').className).toBe('error');
  });
});

test('a redeemed code reports the granted role and tells the caller', async () => {
  // The caller refetches on this: every cached answer was computed under
  // the old role, including the roster's contribution query.
  const onRedeemed = vi.fn();
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: 'member',
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={onRedeemed} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'GOODCODE01' } });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(screen.getByText('You are now member.')).toBeDefined();
  });
  expect(onRedeemed).toHaveBeenCalledOnce();
});

test('the code is trimmed before it is sent', async () => {
  // Codes get copied out of chat, and a trailing space is not a wrong code.
  const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: 'member',
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), {
    target: { value: '  GOODCODE01 ' },
  });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(rpc).toHaveBeenCalledWith('redeem_join_code', { p_code: 'GOODCODE01' });
  });
});
