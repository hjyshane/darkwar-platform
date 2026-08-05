import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }));

import { SignUpForm } from '../src/features/auth/SignUpForm';

/** The bug this form fixes: 0021 built the whole join-code flow and it was
 * unreachable, because JoinCodeForm only renders for a signed-in viewer and
 * nothing created one. */

beforeEach(() => {
  vi.clearAllMocks();
});

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

test('signing up asks GoTrue, with the address trimmed', async () => {
  auth.signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null });
  render(<SignUpForm onSignedIn={() => {}} />);

  fill('  someone@example.test  ', 'a-long-enough-password');

  await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1));
  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'someone@example.test',
    password: 'a-long-enough-password',
  });
});

test('no session back means confirmation is on, and the form says so', async () => {
  // Supabase returns a user with no session when confirmations are enabled.
  // Telling the reader to sign in now would be advice that cannot work.
  auth.signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null });
  const onSignedIn = vi.fn();
  render(<SignUpForm onSignedIn={onSignedIn} />);

  fill('someone@example.test', 'a-long-enough-password');

  await screen.findByText(/confirmation link/i);
  expect(onSignedIn).not.toHaveBeenCalled();
});

test('a session back means confirmations are off, and it hands over', async () => {
  auth.signUp.mockResolvedValue({
    data: { session: { access_token: 'x' }, user: {} },
    error: null,
  });
  const onSignedIn = vi.fn();
  render(<SignUpForm onSignedIn={onSignedIn} />);

  fill('someone@example.test', 'a-long-enough-password');

  await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/confirmation link/i)).toBeNull();
});

test('a refused sign-up shows what GoTrue said', async () => {
  // Unlike sign-in, these are about the request rather than about whether an
  // account exists, so passing the message through leaks nothing.
  auth.signUp.mockResolvedValue({
    data: { session: null, user: null },
    error: { message: 'Password should be at least 8 characters.' },
  });
  render(<SignUpForm onSignedIn={() => {}} />);

  fill('someone@example.test', 'short');

  const message = await screen.findByText('Password should be at least 8 characters.');
  expect(message.className).toBe('error');
});

test('the password field asks the browser for a new one, not the saved one', () => {
  render(<SignUpForm onSignedIn={() => {}} />);

  const password = screen.getByLabelText('Password');
  expect(password.getAttribute('autocomplete')).toBe('new-password');
  expect(password.getAttribute('minlength')).toBe('8');
});
