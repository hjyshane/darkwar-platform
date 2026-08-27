// FR-UI-007/008: freshness is visible, and unknown values render as
// unknown — never as zero. The monthly pass is deliberately ABSENT from
// this table: it lives on its own unlinked page (see route.ts), and a
// test below pins that it does not creep back in.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { type RosterRow, RosterTable } from '../src/features/roster/RosterTable';
import { MAX_COLUMN_WIDTH, type TableLayouts } from '../src/lib/tableLayout';
import { renderWithQuery } from './renderWithQuery';

const NOW = new Date('2026-07-28T12:00:00Z');

/** A member the collector has seen and nothing else knows anything about.
 * Named so other fixtures can start from it instead of restating twenty-five
 * nulls. */
const emptyRow: RosterRow = {
  member_rank: null,
  below_minimum: null,
  player_id: 'p2',
  current_name: null,
  hq_level: null,
  power: null,
  kills: null,
  daily_donation_score: null,
  weekly_donation_score: null,
  duel_daily_score: null,
  duel_weekly_score: null,
  duel_round_score: null,
  assigned_rank: null,
  computed_rank: null,
  rank_score: null,
  growth_1d: null,
  growth_7d: null,
  growth_1d_at: null,
  growth_7d_at: null,
  online_state: null,
  last_online_at: null,
  last_seen_at: null,
  month_card_expires_at: null,
  vip_level: null,
  vip_expires_at: null,
  svip_level: null,
};

const rows: RosterRow[] = [
  {
    member_rank: 4,
    below_minimum: false,
    player_id: 'p1',
    current_name: 'SyntheticPlayer01',
    hq_level: 21,
    power: 200_000_000,
    kills: 1_000_000,
    daily_donation_score: 14_500,
    weekly_donation_score: 86_440,
    duel_daily_score: 5_658_634,
    duel_weekly_score: 26_865_932,
    duel_round_score: 103_501_541,
    online_state: 'offline',
    last_online_at: '2026-07-28T09:00:00Z',
    last_seen_at: '2026-07-28T11:55:00Z',
    assigned_rank: 'R4',
    computed_rank: 'R3',
    rank_score: 88.4,
    growth_1d: 2.44,
    growth_7d: -1.06,
    growth_1d_at: '2026-07-27T09:00:00Z',
    growth_7d_at: '2026-07-21T09:00:00Z',
    month_card_expires_at: '2026-08-25T02:00:00Z',
    vip_level: 9,
    vip_expires_at: '2026-09-01T00:00:00Z',
    svip_level: 2,
  },
  emptyRow,
];

/** Promoted here, not yet in the game: R2 on the member list, R5 by our
 * decision. The one row where "which rank" has two answers, which is what the
 * grouping and the mismatch marker are both about. */
const mismatched: RosterRow = {
  ...emptyRow,
  player_id: 'p3',
  current_name: 'SyntheticPlayer03',
  member_rank: 2,
  assigned_rank: 'R5',
};

/** Every row with nothing to say about subscriptions — what the database hands a
 * member, because RLS filtered the rows away rather than refusing the query. */
const withoutSubscriptions: RosterRow[] = rows.map((row) => ({
  ...row,
  month_card_expires_at: null,
  vip_level: null,
  vip_expires_at: null,
  svip_level: null,
}));

test('renders roster with freshness badge', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.getByText('SyntheticPlayer01')).toBeDefined();
  expect(screen.getByText('5m ago')).toBeDefined();
});

test("last online is the player's own clock, not the collector's", () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // Two facts about the same row: last online 3h ago, last looked at 5m ago.
  // Before 0024 the second was labelled as if it were the first.
  expect(screen.getByText('3h ago')).toBeDefined();
  expect(screen.getByText('5m ago')).toBeDefined();
});

test('presence we were never shown reads as unknown, not offline', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // A redacted roster, a non-member, or a logged-out reader all land here.
  expect(screen.queryByText('Offline')).toBeNull();
});

test('missing values render as unknown, not zero', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // A member with no name reads as "Unnamed" rather than as their game uid.
  // The uid used to stand in here, which meant the one row that could not
  // be identified by name was the one row that printed an identifier.
  expect(screen.getByText('Unnamed')).toBeDefined();
  expect(screen.getByText('No data')).toBeDefined();
  expect(screen.queryByText('0')).toBeNull();
});

test('no game uid reaches this screen, in any cell', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // Not "the column is gone" — the whole point is that the number is not on
  // the page at all, including as a fallback, a title or a label.
  expect(document.body.textContent).not.toMatch(/\b58\d{6}\b/);
  expect(document.body.innerHTML).not.toMatch(/\b58\d{6}\b/);
});

test('empty roster states itself instead of a bare table', () => {
  renderWithQuery(<RosterTable rows={[]} now={NOW} />);
  expect(screen.getByText('No member data yet.')).toBeDefined();
});

test('contribution scores appear, and unknown stays a dash', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  // Donation's two boards, both from the 2026-08-01 capture's top entry: the
  // weekly figure is its own reading, which is why it is not 14,500 × 7.
  expect(screen.getByText('14,500')).toBeDefined();
  expect(screen.getByText('86,440')).toBeDefined();
  // The duel's three boards each get their own figure. They shared one column
  // until 0028, where the number shown depended on insert order.
  expect(screen.getByText('5,658,634')).toBeDefined();
  expect(screen.getByText('26,865,932')).toBeDefined();
  expect(screen.getByText('103,501,541')).toBeDefined();
  // The second player has no observed contribution: dashes, not zeros.
  expect(screen.queryByText('0')).toBeNull();
});

test('the monthly pass does not appear in the roster', () => {
  // Admin-only finance data has its own page, reached only by typing its
  // address; the shared dashboard must not even name it.
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);
  expect(screen.queryByText('Monthly Card')).toBeNull();
});

test('growth carries its sign and its direction, and unknown carries neither', () => {
  renderWithQuery(<RosterTable rows={rows} now={NOW} />);

  // The sign is in the text, so the colour is emphasis rather than the
  // message — a reader who cannot separate the two hues still reads these.
  const up = screen.getByText('+2.4%');
  const down = screen.getByText('-1.1%');
  expect(up.className).toContain('growth-up');
  expect(down.className).toContain('growth-down');

  // The second member has no earlier snapshot. That is not 0% — a member
  // whose power has not been measured twice has an unknown change, and
  // FR-UI-008 says an unknown never wears a nought.
  expect(screen.queryByText('0.0%')).toBeNull();
  expect(
    document.querySelectorAll('td[title="No earlier snapshot to compare against"]').length,
  ).toBe(2);
});

// Grouping by OUR rank — assigned if an admin set one, otherwise what the last
// period computed. It used to group by the GAME's member_rank; the table now reads
// as "the alliance as we intend it", and the game's disagreement is carried per row
// by the mismatch marker rather than by the shape of the whole table.
test('members are grouped by the rank we decided, highest first', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={rows} />);
  const headings = screen.getAllByRole('columnheader', { name: /R[1-5]|Rank not decided/ });
  const labels = headings.map((cell) => cell.textContent ?? '');
  // p1 is assigned R4 and p2 has neither assignment nor computed tier.
  expect(labels[0]).toContain('R4');
  expect(labels.at(-1)).toContain('Rank not decided');
});

// The distinction the previous test cannot make on its own: p3 is R2 in the game
// and R5 by our decision, and it is the DECISION that files the row. Grouping by
// member_rank would put it under R2.
test('a member we promoted is filed under our rank, not the game s', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={[...rows, mismatched]} />);
  const heading = screen.getByRole('columnheader', { name: /R5/ });
  expect(heading.textContent).toContain('1 member');
});

// A member with no decision at all is kept, in a group of their own. Dropping them
// would lose a member from a roster; lumping them into R1 would assert a rank
// nobody decided.
test('an undecided rank is its own group rather than a guess', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={rows} />);
  const heading = screen.getByRole('columnheader', { name: /Rank not decided/ });
  expect(heading).toBeTruthy();
  // And the member is still counted rather than dropped from the roster.
  expect(heading.textContent).toContain('1 member');
});

/** A reader with a role, without mocking the module: the cache answers the same
 * useSession the component always calls. */
function asRole(role: 'member' | 'officer') {
  return [[['session'], { email: `${role}@test.invalid`, role }]] as const;
}

// The rank column is where rank decisions are MADE — a dropdown an officer uses
// while looking at the figures on the same row. A member cannot use it, and a
// disabled control they can see is a worse answer than a column that is not
// there. The figures behind it stay member-readable server-side, because the
// grouping needs them for everybody.
test('the rank column is for officers and admins, not members', () => {
  const { unmount } = renderWithQuery(
    <RosterTable columns={[]} now={NOW} rows={rows} />,
    asRole('member'),
  );
  expect(screen.queryByRole('columnheader', { name: /^Rank$/ })).toBeNull();
  unmount();

  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={rows} />, asRole('officer'));
  expect(screen.getByRole('columnheader', { name: /^Rank$/ })).toBeTruthy();
});

// The mismatch is a to-do: "the game says R2, we decided R5, go change it". It is
// marked for the people who can act on it and nobody else — and never by colour
// alone (NFR-011), so the cell prints the game's rank in words too.
test('a rank mismatch is marked for officers, in words as well as colour', () => {
  renderWithQuery(
    <RosterTable columns={[]} now={NOW} rows={[...rows, mismatched]} />,
    asRole('officer'),
  );
  const marked = document.querySelectorAll('tr.rank-mismatch');
  expect(marked.length).toBe(1);
  expect(marked[0]?.textContent).toContain('SyntheticPlayer03');
  expect(marked[0]?.textContent).toContain('≠ game R2');
  // p1 is R4 both ways — agreement is not a mismatch.
  expect(document.body.textContent).not.toContain('≠ game R4');
});

test('a member sees no mismatch marks at all', () => {
  renderWithQuery(
    <RosterTable columns={[]} now={NOW} rows={[...rows, mismatched]} />,
    asRole('member'),
  );
  expect(document.querySelectorAll('tr.rank-mismatch').length).toBe(0);
  expect(document.body.textContent).not.toContain('≠ game');
});

// The group label sits in its own element so it can stay put while the table
// scrolls sideways (`.group-label`). Sticking the cell would do nothing — it spans
// every column, so it is already as wide as the table.
test('the rank heading label is its own stickable element', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={rows} />);
  const label = document.querySelector('.group-row th > .group-label');
  expect(label).not.toBeNull();
  expect(label?.textContent).toContain('R4');
});

/** Render with a saved arrangement already in the cache.
 *
 * The table reads the arrangement through react-query rather than a prop, so this
 * seeds the same cache key the hook reads. Going through the cache rather than
 * stubbing the hook is the point: it proves the wiring, not just `arrangeColumns`,
 * which has its own tests.
 */
function renderArranged(layout: TableLayouts) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(['table-layout'], layout);
  return render(
    <QueryClientProvider client={client}>
      <RosterTable columns={[]} now={NOW} rows={rows} />
    </QueryClientProvider>,
  );
}

/** The header labels, without the sort affordance the header draws after them. */
function headerOrder(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map((cell) =>
    (cell.textContent ?? '').replace(/[↕↑↓▲▼]/g, '').trim(),
  );
}

test('a saved order puts the columns where an admin put them', () => {
  renderArranged({ members: { order: ['kills', 'power'] } });
  const order = headerOrder();
  expect(order.indexOf('Kills')).toBeLessThan(order.indexOf('Power'));
  // And what the saved order never mentioned is still here, in its declared place —
  // the failure this shape exists to avoid is a stored list swallowing every column
  // added after it was saved.
  expect(order).toContain('HQ');
});

test('a hidden column leaves the table', () => {
  renderArranged({ members: { hidden: ['kills'] } });
  expect(headerOrder()).not.toContain('Kills');
  expect(headerOrder()).toContain('Power');
});

test('the name column is shown even when the setting says to hide it', () => {
  // Not a hypothetical: `hidden` is free text in a JSON settings row. Hiding the
  // name leaves a grid of figures belonging to nobody, so the table refuses rather
  // than the form.
  renderArranged({ members: { hidden: ['name'] } });
  expect(screen.getByText('SyntheticPlayer01')).toBeDefined();
});

test('a saved width reaches the column, clamped', () => {
  renderArranged({ members: { width: { power: 4000, kills: 120 } } });
  const widths = Array.from(document.querySelectorAll('colgroup col')).map(
    (col) => (col as HTMLElement).style.width,
  );
  expect(widths).toContain('120px');
  // 4000px would push every other column off the screen; MAX_COLUMN_WIDTH wins.
  expect(widths).toContain(`${MAX_COLUMN_WIDTH}px`);
});

// 0092. Officers and admins get these two columns; everybody else gets a query
// that returned no subscription rows at all, and therefore no columns — a column
// of dashes would say "nobody has a pass" rather than "this is not for you".
test('subscription columns appear for a reader the database answered', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={rows} />);
  expect(headerOrder()).toContain('Monthly pass');
  expect(headerOrder()).toContain('VIP');
  expect(screen.getByText('2026-08-25')).toBeDefined();
  // SVIP rides alongside rather than being added in: 9 and S2 are two ladders.
  expect(screen.getByText('9 · S2')).toBeDefined();
});

test('and are absent entirely for a reader it did not', () => {
  renderWithQuery(<RosterTable columns={[]} now={NOW} rows={withoutSubscriptions} />);
  expect(headerOrder()).not.toContain('Monthly pass');
  expect(headerOrder()).not.toContain('VIP');
});
