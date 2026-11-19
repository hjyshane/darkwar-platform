import { describe, expect, it } from 'vitest';
import { mustPickCharacter, openWhilePicking } from './characterGate';
import type { AppRole, SessionState } from './useSession';

function session(role: AppRole, playerId: string | null, realRole?: AppRole): SessionState {
  return { email: 'a@b', userId: 'u', role, playerId, ...(realRole ? { realRole } : {}) };
}

describe('mustPickCharacter', () => {
  it('stops a member or officer with no character', () => {
    expect(mustPickCharacter(session('member', null))).toBe(true);
    expect(mustPickCharacter(session('officer', null))).toBe(true);
  });

  it('lets anybody with a character through', () => {
    expect(mustPickCharacter(session('member', 'p1'))).toBe(false);
    expect(mustPickCharacter(session('officer', 'p1'))).toBe(false);
  });

  it('never stops an admin, a community account or a viewer', () => {
    expect(mustPickCharacter(session('admin', null))).toBe(false);
    expect(mustPickCharacter(session('community', null))).toBe(false);
    expect(mustPickCharacter(session('viewer', null))).toBe(false);
  });

  it('reads the real role, so an admin viewing as a member is not stopped', () => {
    expect(mustPickCharacter(session('member', null, 'admin'))).toBe(false);
  });

  it('says no while the session is still loading', () => {
    expect(mustPickCharacter(undefined)).toBe(false);
  });
});

describe('openWhilePicking', () => {
  it('keeps sign-in and the legal pages open', () => {
    for (const route of ['login', 'terms', 'privacy'] as const) {
      expect(openWhilePicking(route)).toBe(true);
    }
  });

  it('closes everything else', () => {
    for (const route of ['home', 'overview', 'members', 'account', 'admin', 'player'] as const) {
      expect(openWhilePicking(route)).toBe(false);
    }
  });
});
