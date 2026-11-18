// The one-step join: redeem first, then link the typed name only when it is
// exactly one of our characters. Supabase is mocked; what the database
// refuses is pgTAP's (redeem_join_code 0021, claim_player 0068).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  redeem: { data: 'member' as string | null, error: null as { message: string } | null },
  found: [] as { player_id: string; current_name: string }[],
  claimError: null as { message: string } | null,
  calls: [] as string[],
  pattern: '' as string,
  uid: null as string | null,
}));

vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    filter: (column: string, _op: string, value: string) => {
      if (column === 'game_uid') mock.uid = value;
      return chain;
    },
    ilike: (_column: string, pattern: string) => {
      mock.pattern = pattern;
      return chain;
    },
    limit: async () => ({ data: mock.found, error: null }),
  };
  return {
    supabase: {
      rpc: async (fn: string) => {
        mock.calls.push(fn);
        return fn === 'redeem_join_code' ? mock.redeem : { data: null, error: mock.claimError };
      },
      from: () => chain,
    },
  };
});

import { exactLike, joinAndClaim, looksLikeUid } from './joinAndClaim';

beforeEach(() => {
  mock.redeem = { data: 'member', error: null };
  mock.found = [];
  mock.claimError = null;
  mock.calls = [];
  mock.pattern = '';
  mock.uid = null;
});

describe('joinAndClaim', () => {
  it('stops at a refused code without looking anybody up', async () => {
    mock.redeem = { data: null, error: null };
    expect(await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: 'Ann' })).toEqual({
      kind: 'refused',
      message: 'That code is not valid.',
    });
    expect(mock.calls).toEqual(['redeem_join_code']);
  });

  it('passes the lockout through as written', async () => {
    mock.redeem = { data: null, error: { message: 'too many attempts' } };
    expect(await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: 'Ann' })).toEqual({
      kind: 'refused',
      message: 'too many attempts',
    });
  });

  it('links the one character with that name', async () => {
    mock.found = [{ player_id: 'p1', current_name: 'Ann' }];
    expect(await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: '  ann ' })).toEqual({
      kind: 'joined',
      role: 'member',
      linked: 'Ann',
      note: null,
    });
    expect(mock.calls).toEqual(['redeem_join_code', 'claim_player']);
    expect(mock.pattern).toBe('ann');
  });

  it('joins but leaves the choice to the picker when the name is not unique or not found', async () => {
    mock.found = [
      { player_id: 'p1', current_name: 'Ann' },
      { player_id: 'p2', current_name: 'ANN' },
    ];
    const two = await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: 'Ann' });
    expect(two).toMatchObject({ kind: 'joined', linked: null });
    expect(mock.calls).toEqual(['redeem_join_code']);

    mock.found = [];
    const none = await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: 'Zed' });
    expect(none).toMatchObject({ kind: 'joined', linked: null });
    expect(none.kind === 'joined' && none.note).toContain('Pick yours below');
  });

  it('joins with no name and asks for nothing more', async () => {
    expect(await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: '' })).toEqual({
      kind: 'joined',
      role: 'member',
      linked: null,
      note: null,
    });
    expect(mock.calls).toEqual(['redeem_join_code']);
  });

  it('still joins when the link is refused, and says why', async () => {
    mock.found = [{ player_id: 'p1', current_name: 'Ann' }];
    mock.claimError = { message: 'that player is already linked to another account' };
    const outcome = await joinAndClaim('AAAAA-BBBBB', { kind: 'typed', text: 'Ann' });
    expect(outcome).toMatchObject({ kind: 'joined', linked: null });
    expect(outcome.kind === 'joined' && outcome.note).toContain('already linked');
  });
});

describe('picking and typing', () => {
  it('links a character picked from the roster without looking it up', async () => {
    const outcome = await joinAndClaim('AAAAA-BBBBB', {
      kind: 'picked',
      playerId: 'p9',
      name: 'Ann',
    });
    expect(outcome).toEqual({ kind: 'joined', role: 'member', linked: 'Ann', note: null });
    expect(mock.calls).toEqual(['redeem_join_code', 'claim_player']);
    expect(mock.pattern).toBe('');
  });

  it('looks a typed number up as a game uid, not a name', async () => {
    mock.found = [{ player_id: 'p1', current_name: 'Ann' }];
    const outcome = await joinAndClaim('AAAAA-BBBBB', {
      kind: 'typed',
      text: ' 9331000000000001 ',
    });
    expect(outcome).toMatchObject({ kind: 'joined', linked: 'Ann' });
    expect(mock.uid).toBe('9331000000000001');
    expect(mock.pattern).toBe('');
  });

  it('tells a uid from a name', () => {
    expect(looksLikeUid('9331000000000001')).toBe(true);
    expect(looksLikeUid('Ann')).toBe(false);
    expect(looksLikeUid('12345')).toBe(false);
  });
});

describe('exactLike', () => {
  it('escapes the pattern characters so a name matches only itself', () => {
    expect(exactLike(' 100%_Ann\\ ')).toBe('100\\%\\_Ann\\\\');
  });
});
