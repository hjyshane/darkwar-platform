// The header toggle must show the alliance that was just clicked. The choice
// lives outside React (activeAlliance.ts), so this goes through the real hook
// and the real buttons: click, then read aria-pressed, which is what the CSS
// colours.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AllianceSwitcher } from '../src/components/AllianceSwitcher';
import { setActiveAlliance } from '../src/lib/activeAlliance';
import { useActiveAlliance } from '../src/lib/useMyAlliances';

vi.mock('../src/lib/useSession', () => ({
  useSession: () => ({ data: { userId: 'u-1', role: 'admin' } }),
}));

const CBFW = '00000000-0000-4000-8000-00000000c001';
const ACE = '00000000-0000-4000-8000-00000000a001';
const ALLIANCES = [
  { alliance_id: CBFW, name: 'HELLBOUND', code: 'CBFW', server_id: 580, role: 'admin' },
  { alliance_id: ACE, name: 'Ascension', code: 'ACE', server_id: 579, role: 'admin' },
];

function Header() {
  const { alliances, active, switchTo } = useActiveAlliance();
  return (
    <AllianceSwitcher
      alliances={alliances}
      activeId={active?.alliance_id ?? null}
      onSwitch={switchTo}
    />
  );
}

afterEach(() => {
  setActiveAlliance(null);
});

test('clicking the other alliance moves the pressed state with it', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['my-alliances', 'u-1'], ALLIANCES);
  render(
    <QueryClientProvider client={client}>
      <Header />
    </QueryClientProvider>,
  );
  const cbfw = screen.getByRole('button', { name: 'CBFW' });
  const ace = screen.getByRole('button', { name: 'ACE' });
  expect(cbfw.getAttribute('aria-pressed')).toBe('true');
  expect(ace.getAttribute('aria-pressed')).toBe('false');

  fireEvent.click(ace);

  expect(screen.getByRole('button', { name: 'ACE' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'CBFW' }).getAttribute('aria-pressed')).toBe('false');
});
