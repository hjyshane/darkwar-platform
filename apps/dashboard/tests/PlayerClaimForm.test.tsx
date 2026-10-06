// What the member can see about their own characters.
//
// Since 0193 an account is any number of characters — one per alliance, or
// alts — and each character belongs to at most one account. Linking is
// immediate (0175), so the screen is a list of who you are plus a picker to
// add another; the rules below are about the SENTENCES: a name read back,
// never a uuid printed at somebody, and no promise of an approver.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PlayerClaimForm } from '../src/features/auth/PlayerClaimForm';

const ROSTER = [
  { player_id: 'p-1', current_name: 'Bored101', code: 'CBFW' },
  { player_id: 'p-2', current_name: 'VINA ăn cướp', code: 'CBFW' },
  { player_id: 'p-3', current_name: 'AltInBravo', code: 'BRV' },
];

function renderForm(options: {
  mine?: { player_id: string; current_name: string | null }[];
  roster?: typeof ROSTER;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['claimable'], options.roster ?? ROSTER);
  client.setQueryData(['my-players'], options.mine ?? []);
  return render(
    <QueryClientProvider client={client}>
      <PlayerClaimForm />
    </QueryClientProvider>,
  );
}

test('an account with no character is asked, and told it is immediate', async () => {
  const { container } = renderForm({ mine: [] });
  expect(await screen.findByText(/No character linked yet/)).toBeDefined();
  expect(container.textContent).toContain('takes effect as soon as you pick');
  // This reverses 0066 on purpose (0175): a member told an officer will
  // confirm it waits for a confirmation that already happened.
  expect(container.textContent).not.toContain('officer');
});

test('an account with two characters lists both, and says which it is shown as', async () => {
  renderForm({
    mine: [
      { player_id: 'p-1', current_name: 'Bored101' },
      { player_id: 'p-3', current_name: 'AltInBravo' },
    ],
  });
  const list = await screen.findByRole('list');
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('Bored101');
  expect(items[0]?.textContent).toContain('shown as');
  expect(items[1]?.textContent).toContain('AltInBravo');
  expect(items[1]?.textContent).not.toContain('shown as');
  expect(within(list).getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
});

test('an account with a character linked is not offered another', async () => {
  renderForm({ mine: [{ player_id: 'p-1', current_name: 'Bored101' }] });
  await screen.findByText('Bored101');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'This is me' })).toBeNull();
});

test('the first-link picker names each character with its alliance', async () => {
  renderForm({ mine: [] });
  const picker = await screen.findByLabelText('Character');
  // The picker is a custom listbox: its options exist once it is open.
  fireEvent.click(picker);
  const options = within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent);
  expect(options).toContain('VINA ăn cướp [CBFW]');
  expect(options).toContain('AltInBravo [BRV]');
});

test('a linked character with no name does not print a uuid at somebody', async () => {
  renderForm({ mine: [{ player_id: 'p-9', current_name: null }], roster: [] });
  const list = await screen.findByRole('list');
  expect(list.textContent).toContain('no name yet');
  expect(list.textContent).not.toContain('p-9');
});
