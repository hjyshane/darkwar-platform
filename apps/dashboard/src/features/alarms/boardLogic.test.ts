import { describe, expect, test } from 'vitest';
import { categoryKey, removeBoardText, watchableEvents } from './boardLogic';

describe('categoryKey', () => {
  test('a key from the label, lower case and dashed', () => {
    expect(categoryKey('Bear Hunt', [])).toBe('bear-hunt');
    expect(categoryKey('  Server Clash (S4)! ', [])).toBe('server-clash-s4');
  });

  test('a label with nothing usable still gets a key', () => {
    expect(categoryKey('★★★', [])).toBe('board');
  });

  test('a key already taken in the alliance gets the next free suffix', () => {
    expect(categoryKey('Bear Hunt', ['bear-hunt'])).toBe('bear-hunt-2');
    expect(categoryKey('Bear Hunt', ['bear-hunt', 'bear-hunt-2'])).toBe('bear-hunt-3');
  });

  test("a typed label never lands on a game board's key", () => {
    // The game's boards use underscores; a derived key never has one.
    expect(categoryKey('game zombie siege', ['game_zombie_siege'])).toBe('game-zombie-siege');
  });
});

describe('watchableEvents', () => {
  const event = (activityId: string, name: string) => ({
    activityId,
    name,
    startsAt: null,
    endsAt: null,
  });

  test('the Siege and Frankie windows are not offered: their entries come from the picks', () => {
    const offered = watchableEvents(
      [
        event('41008', 'Zombie Siege'),
        event('111401', 'Bio-Mutant'),
        event('66008', 'Bio-Mutant'),
        event('40748', 'Maple Isle Clash'),
      ],
      [],
    );
    expect(offered.map((e) => e.activityId)).toEqual(['40748']);
  });

  test('one option per activity, and none for an activity already watched', () => {
    const offered = watchableEvents(
      [
        event('40748', 'Maple Isle Clash'),
        event('40748', 'Maple Isle Clash'),
        event('111001', 'Capital Clash'),
        event('55519', 'Azure Catastrophe'),
      ],
      [{ activityId: '111001' }, { activityId: null }],
    );
    expect(offered.map((e) => e.activityId)).toEqual(['40748', '55519']);
  });
});

describe('removeBoardText', () => {
  const board = (category: string, activityId: string | null) => ({
    category,
    label: 'X',
    activityId,
  });

  test('a board of its own is deleted; its entries keep their alarms on the reminder channel', () => {
    const text = removeBoardText(board('bear-hunt', null));
    expect(text.action).toBe('Delete board');
    expect(text.confirm).toMatch(/keep their alarms/);
    expect(text.confirm).toMatch(/reminder channel/);
  });

  test('a watched game event is un-watched by deleting its board', () => {
    const text = removeBoardText(board('game_40748', '40748'));
    expect(text.action).toBe('Stop watching');
    expect(text.yes).toBe('Yes, stop watching');
    expect(text.confirm).toMatch(/keep their alarms/);
  });

  test('a pick board says the game will put it back', () => {
    expect(removeBoardText(board('game_zombie_siege', null)).confirm).toMatch(/puts it back/);
    expect(removeBoardText(board('bear-hunt', null)).confirm).not.toMatch(/puts it back/);
  });
});
