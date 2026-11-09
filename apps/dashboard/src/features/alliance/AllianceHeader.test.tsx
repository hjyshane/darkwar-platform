import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AllianceHeaderView, type AllianceHeaderViewProps } from './AllianceHeader';
import type { AllianceInfo } from './info';

afterEach(cleanup);

const NOW = new Date('2026-11-09T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const INFO: AllianceInfo = {
  snapshot_id: 's1',
  alliance_id: 'ours',
  server_id: 580,
  external_id: 'ext',
  name: 'HELLBOUND',
  code: 'CBFW',
  power: 4_120_000_000,
  member_count: 93,
  leader_game_uid: 1,
  intro: 'hello',
  announce: null,
  language: '391083',
  join_approval: 1,
  min_power: 30_000_000,
  min_hq: 20,
  max_members: 100,
  country: 'TW',
  captured_at: hoursAgo(2),
};

const BASE: AllianceHeaderViewProps = {
  allianceId: 'ours',
  serverId: 580,
  power: 4_120_000_000,
  memberCount: 93,
  observed: 84,
  membersFrom: 'roster',
  rosterCapturedAt: hoursAgo(3),
  rosterComplete: true,
  info: INFO,
  standing: [
    { alliance_id: 'top', power: 5_320_000_000, code: 'ADET' },
    { alliance_id: 'ours', power: 4_120_000_000, code: 'CBFW' },
    { alliance_id: 'low', power: 1_000_000_000, code: 'LOW' },
  ],
  readings: [
    { captured_at: hoursAgo(1), power: 4_120_000_000 },
    { captured_at: hoursAgo(24 * 8), power: 3_920_000_000 },
  ],
  now: NOW,
};

function cells(container: HTMLElement): Record<string, { value: string; context: string | null }> {
  const out: Record<string, { value: string; context: string | null }> = {};
  for (const cell of container.querySelectorAll('.cell')) {
    const label = cell.querySelector('.cell-label')?.textContent ?? '';
    out[label] = {
      value: cell.querySelector('.cell-value')?.textContent ?? '',
      context: cell.querySelector('.cell-context')?.textContent ?? null,
    };
  }
  return out;
}

describe('AllianceHeaderView', () => {
  it('renders the six cells with their contexts', () => {
    const { container } = render(<AllianceHeaderView {...BASE} />);
    expect(cells(container)).toEqual({
      Power: { value: '4.1G', context: '+200M in 7d' },
      'Rank on server': { value: '#2/3', context: '1.2G behind [ADET]' },
      Members: { value: '93/100', context: '84 observed' },
      'Join (raw)': { value: '1', context: 'meaning unconfirmed' },
      Minimums: { value: '30M · HQ 20', context: null },
      Language: { value: 'Traditional Chinese', context: 'Taiwan' },
    });
    expect(container.querySelector('.cell[data-hero]')?.textContent).toContain('4.1G');
    expect(container.querySelector('.cell[data-tone="up"]')).not.toBeNull();
  });

  it('composes the verdict with the figures in code', () => {
    const { container } = render(<AllianceHeaderView {...BASE} />);
    const verdict = container.querySelector('.verdict');
    expect(verdict?.textContent).toBe(
      '#2 of 3 alliances on 580, 1.2G behind [ADET]. 30M and HQ 20 minimum.',
    );
    expect([...(verdict?.querySelectorAll('code') ?? [])].map((c) => c.textContent)).toEqual([
      '#2',
      '1.2G',
      '30M',
      'HQ 20',
    ]);
  });

  it('shows both status lights for a fresh, finished roster', () => {
    const { container } = render(<AllianceHeaderView {...BASE} />);
    const leds = [...container.querySelectorAll('.led')];
    expect(leds.map((led) => [led.getAttribute('data-tone'), led.textContent])).toEqual([
      ['ok', 'Roster 3h'],
      ['ok', 'Capture complete'],
    ]);
  });

  it('warns on an old roster and flags a cut-short capture', () => {
    const { container } = render(
      <AllianceHeaderView {...BASE} rosterCapturedAt={hoursAgo(72)} rosterComplete={false} />,
    );
    const leds = [...container.querySelectorAll('.led')];
    expect(leds.map((led) => led.getAttribute('data-tone'))).toEqual(['warn', 'bad']);
  });

  it('renders without an info card: dashes, no lights, the standing still read', () => {
    const { container } = render(
      <AllianceHeaderView
        {...BASE}
        info={null}
        membersFrom="last known"
        observed={0}
        readings={[]}
        rosterCapturedAt={null}
      />,
    );
    const read = cells(container);
    expect(read['Join (raw)']).toEqual({ value: '—', context: null });
    expect(read.Minimums?.value).toBe('—');
    expect(read.Language).toEqual({ value: '—', context: null });
    expect(read.Members).toEqual({ value: '93', context: 'none observed' });
    expect(read.Power).toEqual({ value: '4.1G', context: null });
    expect(container.querySelector('.led')).toBeNull();
    expect(container.querySelector('.verdict')?.textContent).toBe(
      '#2 of 3 alliances on 580, 1.2G behind [ADET].',
    );
  });

  it('says so when the member list is last-known rather than a roster', () => {
    const { container } = render(
      <AllianceHeaderView
        {...BASE}
        membersFrom="last known"
        observed={12}
        rosterCapturedAt={null}
      />,
    );
    expect(container.querySelector('.cell-note')?.textContent).toBe(
      'last known alliance, not cleared when somebody leaves',
    );
  });

  it('has no verdict when nothing is known', () => {
    const { container } = render(
      <AllianceHeaderView {...BASE} info={null} readings={null} standing={null} />,
    );
    expect(container.querySelector('.verdict')).toBeNull();
    expect(cells(container)['Rank on server']).toEqual({ value: '—', context: null });
  });
});
