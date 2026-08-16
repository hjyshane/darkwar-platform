// redeem_join_code() returns null for wrong, expired, revoked and
// exhausted alike — it returns rather than raises so the attempt counter it
// just wrote survives. The form must keep that one answer one answer; a
// friendlier message per case would invent a distinction the server
// deliberately refuses to make.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { JoinCodeForm } from '../src/features/auth/JoinCodeForm';
import { supabase } from '../src/lib/supabase';

/** Fill both halves of the code, the way a member pastes one.
 *
 * The form stopped taking the hyphen: it was the character people got wrong,
 * and a wrong character costs an attempt against a five-try lockout. Typing
 * into the first box splits a pasted whole code across both.
 */
function enterCode(value: string) {
  fireEvent.change(screen.getByLabelText(/first half/i), { target: { value } });
}

test('a refused code reads as refused, not as a crash', async () => {
  // null is the refusal. It is not an error, and it is the same answer for
  // every reason a code might not work.
  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: null,
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  enterCode('ACDEFGHJKM');
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
  enterCode('ACDEFGHJKM');
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
  enterCode('ACDEFGHJKM');
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
  enterCode('ACDEFGHJKM');
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(screen.getByText('You are now member.')).toBeDefined();
  });
  expect(onRedeemed).toHaveBeenCalledOnce();
});

test('a pasted code is cleaned and rejoined before it is sent', async () => {
  // Codes get copied out of chat. Surrounding space, the hyphen and lowercase
  // all survive the trip now: the two boxes strip them and put back the one
  // separator `redeem_join_code` compares against.
  const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: 'member',
    error: null,
    // biome-ignore lint/suspicious/noExplicitAny: partial PostgrestResponse
  } as any);

  render(<JoinCodeForm onRedeemed={() => {}} />);
  enterCode('  acdef-ghjkm ');
  fireEvent.click(screen.getByRole('button', { name: /redeem/i }));

  await waitFor(() => {
    expect(rpc).toHaveBeenCalledWith('redeem_join_code', { p_code: 'ACDEF-GHJKM' });
  });
});
