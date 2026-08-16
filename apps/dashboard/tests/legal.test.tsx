// The two pages that have to work for somebody who is not signed in.
//
// The failure this guards against is not a rendering bug. It is a future edit
// that adds `terms` to the wall's side of `standalone` in App.tsx, or drops
// the links from the sign-in page — either of which breaks Google's and
// Discord's OAuth review silently, weeks after the change, in a console
// nobody has open.
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PrivacyPage } from '../src/features/legal/PrivacyPage';
import { TermsPage } from '../src/features/legal/TermsPage';
import { routeFromHash } from '../src/lib/route';

test('both pages have an address of their own', () => {
  expect(routeFromHash('#/terms')).toBe('terms');
  expect(routeFromHash('#/privacy')).toBe('privacy');
});

test('neither page needs a session to render', () => {
  // No QueryClientProvider, no supabase mock, no session. If either page ever
  // grows a query, this throws — and a legal page that cannot render signed
  // out is a legal page that fails the review it exists for.
  render(<TermsPage />);
  expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeTruthy();

  render(<PrivacyPage />);
  expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeTruthy();
});

test('each page links to the other and to the way in', () => {
  render(<TermsPage />);

  expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe(
    '#/privacy',
  );
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('#/login');
});

test('the privacy policy names what it actually stores', () => {
  render(<PrivacyPage />);

  // The three a reader would not guess, and the three most likely to be lost
  // when somebody shortens this page: the daily activity record, the figures
  // held about players who never signed up, and where the database is.
  expect(screen.getByText(/daily activity record/i)).toBeTruthy();
  expect(screen.getByText(/never signed in here/i)).toBeTruthy();
  expect(screen.getByText(/United States/)).toBeTruthy();
});

test('the terms say this is not the game publisher', () => {
  render(<TermsPage />);

  expect(screen.getByRole('heading', { name: 'Not affiliated with the game' })).toBeTruthy();
});

test('both pages carry a contact address', () => {
  // A privacy policy with no way to make a request is not one.
  render(<TermsPage />);
  expect(screen.getByRole('link', { name: 'hjyshane@gmail.com' }).getAttribute('href')).toBe(
    'mailto:hjyshane@gmail.com',
  );

  render(<PrivacyPage />);
  expect(screen.getAllByRole('link', { name: 'hjyshane@gmail.com' }).length).toBeGreaterThan(0);
});
