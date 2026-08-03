// The overview picker offers catalogue metrics and nothing else.
//
// This exists because the trap is easy and was nearly walked into twice.
// The screen used to read `overview_formulas`, which 0048 deleted; the
// obvious repair is to repoint it at `member_formulas`, and that is wrong.
// A formula runs on a MEMBER now and lands as a column on the roster —
// OverviewPanel hardcodes an empty formula list and says so. Offering those
// ids here would let an admin tick a tile, save it, and get nothing, which
// is the exact conflation 0048 existed to undo.
//
// Asserting on the rendered options rather than on the query: what matters
// is what a person can choose, and a future refactor that reintroduces the
// source some other way should still fail this.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { OverviewMetricsSetting } from '../src/features/admin/OverviewMetricsSetting';
import { FORMULA_PREFIX, METRIC_CATALOGUE } from '../src/lib/overviewMetrics';

function renderPicker(tiles: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['overview-metrics-admin'], { tiles });
  return render(
    <QueryClientProvider client={client}>
      <OverviewMetricsSetting />
    </QueryClientProvider>,
  );
}

test('no formula is offered as an overview tile', async () => {
  const { container } = renderPicker(['alliance_power', 'members']);
  await screen.findByText(/Tick what the overview shows/);
  expect(container.innerHTML).not.toContain(FORMULA_PREFIX);
});

test('every catalogue metric is reachable, chosen or not', async () => {
  // Half the point of the screen: a figure this build can draw must be
  // findable, or the only way to get it back is to hand-edit app_settings.
  const { container } = renderPicker(['alliance_power']);
  await screen.findByText(/Tick what the overview shows/);
  for (const metric of METRIC_CATALOGUE) {
    expect(container.textContent).toContain(metric.label);
  }
});
