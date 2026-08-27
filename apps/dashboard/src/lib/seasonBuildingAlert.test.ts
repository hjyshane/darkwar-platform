import { expect, test } from 'vitest';
import { DEFAULT_ALERT, floorsFor, parseAlert } from './seasonBuildingAlert';

const COLUMNS = [{ id: 862000 }, { id: 857000 }];

test('nothing stored means nothing is judged', () => {
  expect(parseAlert(null)).toEqual(DEFAULT_ALERT);
  expect(floorsFor(parseAlert(null), COLUMNS).size).toBe(0);
});

test('a per-building level reaches only that building', () => {
  const alert = parseAlert({ enabled: true, perBuilding: { '862000': 19 } });
  const floors = floorsFor(alert, COLUMNS);
  expect(floors.get(862000)).toBe(19);
  expect(floors.has(857000)).toBe(false);
});

// The switch is separate from the numbers on purpose: an officer can set next
// week's target without every member seeing a mark against their name before
// the alliance has agreed it.
test('levels set but not enabled mark nobody', () => {
  const alert = parseAlert({ enabled: false, perBuilding: { '862000': 19 } });
  expect(floorsFor(alert, COLUMNS).size).toBe(0);
});

// The setting predates per-building floors and production holds one saved in
// the old shape. It has to go on meaning what it meant.
test('the old single level still covers every building on the board', () => {
  const alert = parseAlert({ enabled: true, level: 12 });
  const floors = floorsFor(alert, COLUMNS);
  expect(floors.get(862000)).toBe(12);
  expect(floors.get(857000)).toBe(12);
});

// ...but it must not be mixed underneath the new one, which would put a floor
// under buildings the officer deliberately left out.
test('a per-building level retires the old single one', () => {
  const alert = parseAlert({ enabled: true, level: 12, perBuilding: { '862000': 19 } });
  expect(alert.legacyLevel).toBeNull();
  const floors = floorsFor(alert, COLUMNS);
  expect(floors.get(862000)).toBe(19);
  expect(floors.has(857000)).toBe(false);
});

// A setting is edited by hand often enough that "the row exists" is not the
// same as "the row is usable".
test('unreadable entries are dropped rather than defaulted', () => {
  const alert = parseAlert({
    enabled: true,
    perBuilding: { '862000': 'nineteen', notAnId: 19, '857000': 0, '861000': 18 },
  });
  expect(alert.perBuilding).toEqual({ '861000': 18 });
});
