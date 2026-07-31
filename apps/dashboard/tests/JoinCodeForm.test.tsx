// redeem_join_code() returns null for wrong, expired, revoked and
// exhausted alike — it returns rather than raises so the attempt counter it
// just wrote survives. The form must keep that one answer one answer; a
// friendlier message per case would invent a distinction the server
// deliberately refuses to make.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { JoinCodeForm } from '../src/features/auth/JoinCodeForm';
import { supabase } from '../src/lib/supabase';

test('a refused code reads as refused, not as a crash', async () => {
  // null is the refusal. It is not an error, and it is the same answer for
  // every reason a code might not work.
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'NOPE' } });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(screen.getByText('That code is not valid.').className).toBe('error');
  });
});

test('a refused code does not tell the caller to refetch', async () => {
  // Nothing changed, so invalidating every query would be pure churn.
  const onRedeemed = vi.fn();
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={onRedeemed} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'NOPE' } });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => expect(screen.getByText('That code is not valid.')).toBeDefined());
  expect(onRedeemed).not.toHaveBeenCalled();
});

test('the lockout is shown as the server worded it', async () => {
  // The one raised error, and the only one that is about the caller rather
  // than about which codes exist.
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: { message: 'too many attempts; try again later' },
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'NOPE' } });
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(screen.getByText('too many attempts; try again later').className).toBe('error');
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
