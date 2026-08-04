// The first thing a stranger reads on a dashboard that is now public.
//
// It told everyone "You are signed in". useSession reports 'viewer' for
// BOTH signed-out and signed-in-without-a-row — deliberately, because that
// is what current_app_role() returns for both — so branching the copy on the
// role could not tell the two apart, and the Sign in link it was supposed to
// fall back to was unreachable.
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SignedOutWall } from '../src/App';

test('a stranger is offered a way in, not told they are already in', () => {
  render(<SignedOutWall email={null} />);

  expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByText(/You are signed in/)).toBeNull();
});

test('a signed-in account with no role is told what is missing, and who they are', () => {
  render(<SignedOutWall email="someone@example.com" />);

  // The address is in the sentence because the usual cause of landing here
  // twice is having signed in with the wrong account.
  expect(screen.getByText(/You are signed in as someone@example.com/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'sign-in page' })).toBeTruthy();
});

test('undefined is treated as not signed in', () => {
  // `session?.email` before the query resolves. The wall only renders once
  // the query has settled, but the prop admits undefined, so the safe
  // reading is the one that does not claim a session exists.
  render(<SignedOutWall email={undefined} />);

  expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
});

test('the wall never claims anything here is public', () => {
  render(<SignedOutWall email={null} />);

  expect(screen.getByRole('heading', { name: 'Alliance members only' })).toBeTruthy();
  expect(screen.getByText(/Nothing here is public/)).toBeTruthy();
});
