import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }));

import { LoginPage } from '../src/features/auth/LoginPage';
import { routeFromHash } from '../src/lib/route';

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
});

test('the login address is unlinked but routable', () => {
  expect(routeFromHash('#/login')).toBe('login');
  expect(routeFromHash('#/month-cards')).toBe('monthCards');
  expect(routeFromHash('')).toBe('dashboard');
});

test('submits the entered credentials', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: null });
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.c' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));

  await waitFor(() =>
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' }),
  );
});

test('failure is one neutral message', async () => {
  // Not "wrong password", not "no such user": the form must not confirm
  // whether an account exists.
  auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.c' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));

  expect(await screen.findByText('로그인에 실패했습니다.')).toBeDefined();
  expect(screen.queryByText(/Invalid login/)).toBeNull();
});

test('an existing session shows who you are and offers sign-out', async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { email: 'admin@test.local' } } },
  });
  auth.signOut.mockResolvedValue({ error: null });
  render(<LoginPage />);

  expect(await screen.findByText(/admin@test.local/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});
