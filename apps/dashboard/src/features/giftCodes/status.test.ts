import { describe, expect, test } from 'vitest';
import type { GiftCode, GiftMember, GiftRunner } from './data';
import { claimLabel, claimableSelection, isLive, runnerView, summarise } from './status';

function code(over: Partial<GiftCode> = {}): GiftCode {
  return {
    code_id: 'c1',
    code: 'MAPLE3',
    status: 'working',
    source: 'officer',
    first_seen_at: '2026-10-09T00:00:00Z',
    checked_at: null,
    members: 68,
    queued: 0,
    running: 0,
    done: 0,
    already: 0,
    failed: 0,
    other: 0,
    ...over,
  };
}

describe('claimLabel', () => {
  test('names each status the worker writes', () => {
    expect(claimLabel('queued')).toBe('waiting');
    expect(claimLabel('running')).toBe('sending');
    expect(claimLabel('done')).toBe('received');
    expect(claimLabel('already')).toBe('had it');
    expect(claimLabel('failed')).toBe('failed');
  });

  test('no claim at all is a dash', () => {
    expect(claimLabel(undefined)).toBe('—');
  });

  test('a status this page does not know is shown as it came, not hidden', () => {
    expect(claimLabel('rate_limited')).toBe('rate_limited');
  });
});

describe('isLive', () => {
  test('unverified and working codes can be claimed; dead ones cannot', () => {
    expect(isLive({ status: 'unverified' })).toBe(true);
    expect(isLive({ status: 'working' })).toBe(true);
    expect(isLive({ status: 'expired' })).toBe(false);
    expect(isLive({ status: 'invalid' })).toBe(false);
  });
});

describe('summarise', () => {
  test('received counts both a new reward and one they already had', () => {
    const s = summarise(code({ done: 50, already: 5, queued: 3, running: 1, failed: 2 }));
    expect(s.received).toBe(55);
    expect(s.waiting).toBe(4);
    expect(s.failed).toBe(2);
    expect(s.untouched).toBe(7);
  });

  test('a code nobody has been queued for has the whole roster untouched', () => {
    expect(summarise(code()).untouched).toBe(68);
  });

  test('cancelled and refused pairs are untouched again, not in flight', () => {
    expect(summarise(code({ done: 60, other: 8 })).untouched).toBe(8);
  });

  test('never goes below zero when the roster shrank under a finished code', () => {
    expect(summarise(code({ members: 60, done: 68 })).untouched).toBe(0);
  });
});

describe('claimableSelection', () => {
  const members: GiftMember[] = [
    { game_uid: 1, name: 'Alpha', excluded: false, claims: {} },
    { game_uid: 2, name: 'Bravo', excluded: true, claims: {} },
    { game_uid: 3, name: 'Charlie', excluded: false, claims: {} },
  ];

  test('picks the selected players who are not excluded', () => {
    expect(claimableSelection(members, new Set([1, 2]))).toEqual([1]);
  });

  test('an empty selection claims for nobody, not for everyone', () => {
    expect(claimableSelection(members, new Set())).toEqual([]);
  });
});

describe('runnerView', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const base: GiftRunner = {
    enabled: false,
    paused_until: null,
    halted_reason: null,
    last_sent_at: null,
  };

  test('off by default', () => {
    expect(runnerView(base, now).kind).toBe('off');
  });

  test('off by an officer is just off, not an alarm', () => {
    expect(runnerView({ ...base, halted_reason: 'turned off by an officer' }, now).kind).toBe(
      'off',
    );
  });

  test('a self-stop shows its reason', () => {
    const v = runnerView({ ...base, halted_reason: 'HTTP 429' }, now);
    expect(v.kind).toBe('stopped');
    expect(v.text).toContain('HTTP 429');
  });

  test('on, and on but waiting out a pause', () => {
    expect(runnerView({ ...base, enabled: true }, now).kind).toBe('on');
    const paused = runnerView(
      { ...base, enabled: true, paused_until: '2026-10-09T12:07:30Z' },
      now,
    );
    expect(paused.kind).toBe('paused');
    expect(paused.text).toContain('8 min');
  });

  test('a pause that has passed counts as on', () => {
    const v = runnerView({ ...base, enabled: true, paused_until: '2026-10-09T11:00:00Z' }, now);
    expect(v.kind).toBe('on');
  });
});
