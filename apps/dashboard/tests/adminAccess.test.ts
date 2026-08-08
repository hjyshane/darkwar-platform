import { expect, describe as group, test } from 'vitest';
import {
  ADMIN_SECTIONS,
  canWriteAnything,
  describe as describeRequirement,
  holds,
  missingIn,
  sectionsIn,
} from '../src/lib/adminAccess';
import type { RolePermission } from '../src/lib/permissions';
import { ADMIN_GROUPS } from '../src/lib/route';

/** The seed 0045 installed: everything admin-only except reading notices. */
const SEEDED: RolePermission[] = [
  { role: 'admin', capability: 'members.manage', allowed: true },
  { role: 'admin', capability: 'settings.write', allowed: true },
  { role: 'admin', capability: 'catalogue.write', allowed: true },
  { role: 'officer', capability: 'members.manage', allowed: false },
  { role: 'officer', capability: 'settings.write', allowed: false },
  { role: 'officer', capability: 'catalogue.write', allowed: false },
];

/** The grant that motivated all of this: officers approve player claims, so
 *  somebody ticks this box, and the page then has to stop calling them a
 *  non-admin who may not save anything. */
const OFFICER_MANAGES_MEMBERS: RolePermission[] = SEEDED.map((grant) =>
  grant.role === 'officer' && grant.capability === 'members.manage'
    ? { ...grant, allowed: true }
    : grant,
);

group('the section map', () => {
  test('every group has at least one section', () => {
    for (const entry of ADMIN_GROUPS) {
      expect(sectionsIn(entry.group).length, entry.group).toBeGreaterThan(0);
    }
  });

  test('no section belongs to a group that does not exist', () => {
    const known = new Set(ADMIN_GROUPS.map((entry) => entry.group));
    for (const section of ADMIN_SECTIONS) {
      expect(known.has(section.group), section.id).toBe(true);
    }
  });

  test('capabilities named here are ones the schema actually checks', () => {
    // A capability with no policy behind it reads as "denied" and looks
    // exactly like working correctly, so a typo here would silently tell
    // an admin they lack a permission nobody can hold. These four are the
    // set 0045 registered; adding one means adding the policy first.
    const known = new Set([
      'members.manage',
      'settings.write',
      'catalogue.write',
      'announcement.read',
      'announcement.write',
      'announcement.edit',
      'announcement.delete',
      'guide.write',
      'guide.edit',
      'guide.delete',
    ]);
    for (const section of ADMIN_SECTIONS) {
      if (section.requires?.kind === 'capability') {
        expect(known.has(section.requires.capability), section.id).toBe(true);
      }
    }
  });

  test('game rank is never a requirement', () => {
    // 0045 keeps R1-R5 a label on purpose: a promotion in the game must not
    // hand out write access here. This fails if somebody wires it up.
    const asJson = JSON.stringify(ADMIN_SECTIONS);
    for (const rank of ['R1', 'R2', 'R3', 'R4', 'R5', 'game_rank']) {
      expect(asJson).not.toContain(rank);
    }
  });
});

group('holds', () => {
  test('an admin satisfies both shapes of requirement', () => {
    expect(holds({ kind: 'role', role: 'admin' }, 'admin', SEEDED)).toBe(true);
    expect(holds({ kind: 'capability', capability: 'settings.write' }, 'admin', SEEDED)).toBe(true);
  });

  test('a granted capability is not the admin role', () => {
    // The distinction the old page could not make. join_codes still keys on
    // the role itself, so members.manage does not open Invitations.
    const officer = OFFICER_MANAGES_MEMBERS;
    expect(holds({ kind: 'capability', capability: 'members.manage' }, 'officer', officer)).toBe(
      true,
    );
    expect(holds({ kind: 'role', role: 'admin' }, 'officer', officer)).toBe(false);
  });

  test('a missing grant row denies, the same as a revoked one', () => {
    expect(holds({ kind: 'capability', capability: 'settings.write' }, 'member', [])).toBe(false);
    expect(holds({ kind: 'capability', capability: 'settings.write' }, undefined, SEEDED)).toBe(
      false,
    );
  });

  test('a read-only section needs nothing', () => {
    expect(holds(null, undefined, undefined)).toBe(true);
  });
});

group('what a group tells you', () => {
  test('an admin is told nothing is missing anywhere', () => {
    for (const entry of ADMIN_GROUPS) {
      expect(missingIn(entry.group, 'admin', SEEDED), entry.group).toEqual([]);
    }
  });

  test('a member is short of every requirement the group has', () => {
    expect(missingIn('access', 'member', SEEDED)).toEqual([
      { kind: 'capability', capability: 'members.manage' },
      { kind: 'role', role: 'admin' },
    ]);
    expect(canWriteAnything('access', 'member', SEEDED)).toBe(false);
  });

  test('one requirement is named once however many sections ask for it', () => {
    // Access asks for members.manage twice. Saying so twice in one sentence
    // reads as a fault in the page.
    const missing = missingIn('access', 'member', SEEDED);
    const capabilities = missing.filter((entry) => entry.kind === 'capability');
    expect(capabilities).toHaveLength(1);
  });

  test('an officer with members.manage is short only of the admin role', () => {
    const officer = OFFICER_MANAGES_MEMBERS;
    expect(missingIn('access', 'officer', officer)).toEqual([{ kind: 'role', role: 'admin' }]);
    // And is told the group is partly theirs rather than closed.
    expect(canWriteAnything('access', 'officer', officer)).toBe(true);
  });

  test('a group with no writable section at all still reports honestly', () => {
    const officer = OFFICER_MANAGES_MEMBERS;
    expect(canWriteAnything('catalogue', 'officer', officer)).toBe(false);
    expect(missingIn('catalogue', 'officer', officer)).toEqual([
      { kind: 'capability', capability: 'catalogue.write' },
    ]);
  });

  test('sections that only read are never listed as missing', () => {
    // Operations is three sections, two of them read-only.
    expect(missingIn('operations', 'member', SEEDED)).toEqual([{ kind: 'role', role: 'admin' }]);
  });
});

group('describe', () => {
  test('a capability uses the label the database gave it', () => {
    const wording = describeRequirement({ kind: 'capability', capability: 'members.manage' }, [
      { capability: 'members.manage', label: 'Manage members', description: '', sort_order: 10 },
    ]);
    expect(wording).toBe('"Manage members"');
  });

  test('an unlabelled capability falls back to its name rather than nothing', () => {
    const wording = describeRequirement({ kind: 'capability', capability: 'members.manage' }, []);
    expect(wording).toBe('"members.manage"');
  });

  test('a role requirement says so plainly', () => {
    expect(describeRequirement({ kind: 'role', role: 'admin' }, [])).toBe('the admin role');
  });
});
