// What the member can see about their own claim, at each stage of it.
//
// The rule this must never break is 0066's: `app_users.player_id` moves only
// inside approve_player_claim(), so nothing here grants anything. Everything
// below is about the SENTENCE — a member who has just picked a character out
// of a hundred-name list needs to read that name back, and a member waiting
// on an officer needs the screen to say which character is waiting rather
// than "your claim".
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PlayerClaimForm } from '../src/features/auth/PlayerClaimForm';

const ROSTER = [
  { player_id: 'p-1', current_name: 'Bored101' },
  { player_id: 'p-2', current_name: 'VINA ăn cướp' },
];

function renderForm(options: {
  claim?: { player_id: string; status: string; note: string | null } | null;
  roster?: typeof ROSTER;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['claimable'], options.roster ?? ROSTER);
  client.setQueryData(['my-claim'], options.claim ?? null);
  return render(
    <QueryClientProvider client={client}>
      <PlayerClaimForm />
    </QueryClientProvider>,
  );
}

test('an undecided account is asked the question, not shown a status', async () => {
  renderForm({ claim: null });
  expect(await screen.findByText(/Which character are you\?/)).toBeDefined();
});

test('a pending claim names the character it is waiting on', async () => {
  // "Your claim is waiting" was true and useless. The failure it hides is
  // picking the wrong row, and the person who can catch that is the one
  // reading this line.
  renderForm({ claim: { player_id: 'p-2', status: 'pending', note: null } });
  const waiting = await screen.findByText(/Waiting for an officer to confirm/);
  expect(waiting.textContent).toContain('VINA ăn cướp');
});

test('a pending claim still says something before the roster arrives', async () => {
  // The picker and the name come from the same query, so an empty roster
  // means no name to print. A raw uuid is not an answer to "who did I say I
  // was"; saying nothing at all is worse.
  renderForm({ claim: { player_id: 'p-2', status: 'pending', note: null }, roster: [] });
  const waiting = await screen.findByText(/Waiting for an officer to confirm/);
  expect(waiting.textContent).toContain('the character you picked');
  expect(waiting.textContent).not.toContain('p-2');
});

test('a rejected claim says so and leaves the form usable', async () => {
  // It used to fall through to the neutral "Which character are you?", which
  // reads as the claim never having been filed — so the member files the
  // same one again and an officer rejects it again.
  renderForm({ claim: { player_id: 'p-1', status: 'rejected', note: null } });
  expect(await screen.findByText(/did not accept that claim/)).toBeDefined();
  expect(screen.getByRole('button', { name: /send claim/i })).toBeDefined();
});

test('an approved claim shows the character rather than its id', async () => {
  renderForm({ claim: { player_id: 'p-1', status: 'approved', note: null } });
  const linked = await screen.findByText(/This account is linked to/);
  expect(linked.textContent).toContain('Bored101');
});

test('an approved claim with no roster yet does not print a uuid at somebody', async () => {
  renderForm({ claim: { player_id: 'p-1', status: 'approved', note: null }, roster: [] });
  const linked = await screen.findByText(/This account is linked to/);
  expect(linked.textContent).toContain('your character');
  expect(linked.textContent).not.toContain('p-1');
});

test('the form never offers to link an account by itself', async () => {
  // 0066: self-service linking must not exist. The only write this form
  // makes is a pending claim; if a control ever appears that says otherwise,
  // this is the test that should stop it.
  const { container } = renderForm({ claim: null });
  await screen.findByText(/Which character are you\?/);
  expect(container.textContent).toContain('An officer confirms this');
  expect(container.querySelectorAll('button')).toHaveLength(1);
});
