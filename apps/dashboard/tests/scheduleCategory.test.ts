import { describe, expect, test } from 'vitest';
import { categoryKey } from '../src/features/schedule/schedule';

/** The board key, which is a primary key nobody is ever shown.
 *
 * `schedule_events.category` points at it, so it is derived once when a board is
 * created and never again. Re-deriving on rename would orphan every entry
 * already filed under the old key — the calendar would keep them and lose their
 * colour and their channel, which reads as "the reminders stopped working".
 */

describe('categoryKey', () => {
  test('is a slug of the label', () => {
    expect(categoryKey('Bear hunt', [])).toBe('bear-hunt');
    expect(categoryKey('  Alliance   Duel!  ', [])).toBe('alliance-duel');
  });

  test('suffixes rather than colliding', () => {
    expect(categoryKey('Bear hunt', ['bear-hunt'])).toBe('bear-hunt-2');
    expect(categoryKey('Bear hunt', ['bear-hunt', 'bear-hunt-2'])).toBe('bear-hunt-3');
  });

  test('a label with no latin letters still produces a usable key', () => {
    // The alliance writes in Korean, so this is the normal case rather than an
    // edge one: every character is stripped and the fallback has to carry it.
    // The label is what anybody sees — the key only has to be unique.
    expect(categoryKey('곰사냥', [])).toBe('board');
    expect(categoryKey('연맹대전', ['board'])).toBe('board-2');
  });

  test('is bounded, because it is a key and not a sentence', () => {
    expect(categoryKey('a'.repeat(200), []).length).toBeLessThanOrEqual(40);
  });
});
