import { describe, expect, test } from 'vitest';
import type { GiftCode, GiftMember } from './data';
import { giftStrip } from './strip';

const code = (over: Partial<GiftCode> = {}): GiftCode => ({
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
});

const member = (game_uid: number, excluded = false, extra = false): GiftMember => ({
  game_uid,
  name: `P${game_uid}`,
  excluded,
  claims: {},
  rank: 3,
  extra,
});

const cell = (label: string, codes: GiftCode[] = [], members: GiftMember[] = []) =>
  giftStrip(codes, members).find((entry) => entry.label === label);

describe('giftStrip', () => {
  test('counts the codes that can still be claimed, and says when some are retired', () => {
    const codes = [code(), code({ code_id: 'c2', status: 'expired' })];

    expect(cell('Live codes', codes)).toMatchObject({ value: '1', note: 'of 2 added' });
    expect(cell('Live codes', [code()])?.note).toBe('all of them');
  });

  test('counts who the codes are claimed for, and who is left out', () => {
    const members = [member(1), member(2), member(3, true)];

    expect(cell('Claimed for', [], members)).toMatchObject({ value: '2', note: '1 left out' });
    expect(cell('Claimed for', [], [member(1)])?.note).toBe('the whole roster');
    expect(cell('Claimed for', [], [member(1), member(2, false, true)])).toMatchObject({
      value: '2',
      note: 'the whole roster, plus 1 saved IDs',
    });
  });

  test('adds up the waiting claims (queued and sending) of live codes only', () => {
    const codes = [
      code({ queued: 3, running: 1 }),
      code({ code_id: 'c2', queued: 2 }),
      code({ code_id: 'c3', status: 'expired', queued: 50 }),
    ];

    expect(cell('Waiting', codes)?.value).toBe('6');
  });

  test('adds up the failures of live codes, and says so when there are none', () => {
    expect(cell('Failed', [code({ failed: 2 }), code({ code_id: 'c2', failed: 1 })])).toMatchObject(
      {
        value: '3',
        note: 'on live codes',
      },
    );
    expect(cell('Failed', [code()])).toMatchObject({ value: '0', note: 'none on a live code' });
  });

  test('is all zeros on an empty page, not blank', () => {
    expect(giftStrip([], []).map((entry) => entry.value)).toEqual(['0', '0', '0', '0']);
  });
});
