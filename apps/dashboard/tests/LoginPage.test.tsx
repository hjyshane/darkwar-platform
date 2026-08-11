import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

// useSession reads the caller's own app_users row to show which role the
// database has them at.
const from = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/supabase', () => ({ supabase: { auth, from } }));

import { LoginPage } from '../src/features/auth/LoginPage';
import { routeFromHash } from '../src/lib/route';

/** Retries off: a failing query should surface now, not after backoff. */
function withQueryClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  from.mockReturnValue({
    select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }),
  });
});

test('the login address is unlinked but routable', () => {
  expect(routeFromHash('#/login')).toBe('login');
  expect(routeFromHash('#/month-cards')).toBe('monthCards');
  expect(routeFromHash('')).toBe('overview');
});

test('submits the entered credentials', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: null });
  render(withQueryClient(<LoginPage />));

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() =>
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' }),
  );
});

test('failure is one neutral message', async () => {
  // Not "wrong password", not "no such user": the form must not confirm
  // whether an account exists.
  auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
  render(withQueryClient(<LoginPage />));

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(await screen.findByText('Sign-in failed.')).toBeDefined();
  expect(screen.queryByText(/Invalid login/)).toBeNull();
});

test('signing in does not throw a new account off the page', async () => {
  // THE REGRESSION. Sign-in used to set `window.location.hash = takeReturnTo()`
  // the instant the password was accepted, before the role was known. For an
  // account with no invitation code redeemed that is the members-only wall —
  // reached one step after signing in, and one step before the form that would
  // have let them in. Sign up, code, character is meant to be one flow.
  //
  // Pins the "stays put" half: no navigation, and the signed-in view is on
  // screen so the code form has somewhere to appear. The member half — leaving
  // for the board once the role says there is one — needs a session row and is
  // not mocked here.
  // Seeded so the assertion can tell the two behaviours apart. With nothing
  // remembered, `takeReturnTo()` returns '' and the old code left the hash at
  // '' too — the test would have passed against the bug it is here to catch.
  window.sessionStorage.setItem('dw:returnTo', '#/guides');
  window.location.hash = '';
  auth.signInWithPassword.mockResolvedValue({ error: null });
  render(withQueryClient(<LoginPage />));

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@b.c' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(await screen.findByText(/new@b\.c/)).toBeDefined();
  expect(window.location.hash).toBe('');
});

test('an existing session shows who you are and offers sign-out', async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { email: 'admin@test.local' } } },
  });
  auth.signOut.mockResolvedValue({ error: null });
  render(withQueryClient(<LoginPage />));

  expect(await screen.findByText(/admin@test.local/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});
