import { expect, test } from 'vitest';
import { effectiveGrants, isAllowed } from '../src/lib/permissions';

const ACE = '00000000-0000-4000-8000-00000000a001';

test("an alliance's own row beats the default, whichever arrives first", () => {
  const own = { role: 'officer', capability: 'settings.write', allowed: true, alliance_id: ACE };
  const fallback = {
    role: 'officer',
    capability: 'settings.write',
    allowed: false,
    alliance_id: null,
  };
  for (const rows of [
    [own, fallback],
    [fallback, own],
  ]) {
    const grants = effectiveGrants(rows);
    expect(grants).toHaveLength(1);
    expect(isAllowed(grants, 'officer', 'settings.write')).toBe(true);
  }
});

test('the default stands where the alliance has no row of its own', () => {
  const grants = effectiveGrants([
    { role: 'member', capability: 'announcement.read', allowed: true, alliance_id: null },
  ]);
  expect(isAllowed(grants, 'member', 'announcement.read')).toBe(true);
});

test('a revoked own row is not rescued by a granting default', () => {
  const grants = effectiveGrants([
    { role: 'officer', capability: 'members.manage', allowed: true, alliance_id: null },
    { role: 'officer', capability: 'members.manage', allowed: false, alliance_id: ACE },
  ]);
  expect(isAllowed(grants, 'officer', 'members.manage')).toBe(false);
});
