import { describe, expect, it } from 'vitest';
import { serverStrip } from '../src/features/server/strip';

const alliance = (name: string | null, power: number | null, code: string | null = null) => ({
  name,
  code,
  power,
});
const player = (name: string | null, power: number | null, game_uid: number | null = null) => ({
  name,
  power,
  game_uid,
});

const cell = (
  label: string,
  alliances: ReturnType<typeof alliance>[] = [],
  players: ReturnType<typeof player>[] = [],
) => serverStrip(alliances, players).find((entry) => entry.label === label);

describe('serverStrip', () => {
  it('counts what has been seen, and says it is the newest capture', () => {
    expect(cell('Alliances seen', [alliance('A', 1), alliance('B', 2)])?.value).toBe('2');
    expect(cell('Players seen', [], [player('x', 1)])).toMatchObject({
      value: '1',
      note: 'the newest capture of the board',
    });
  });

  it('names the strongest alliance with its tag and power', () => {
    expect(cell('Strongest alliance', [alliance('Low', 5), alliance('Top', 1_500, 'TOP')])).toEqual(
      {
        label: 'Strongest alliance',
        value: '[TOP] Top',
        note: '1,500 power',
      },
    );
  });

  it('does not treat a missing power as zero, or as the strongest', () => {
    expect(cell('Strongest player', [], [player('Ghost', null), player('Real', 10)])?.value).toBe(
      'Real',
    );
    expect(cell('Strongest player', [], [player('Ghost', null)])?.value).toBeNull();
  });

  it('shows no strongest when the board is empty', () => {
    expect(cell('Strongest alliance')?.value).toBeNull();
  });

  it('falls back to the UID for an unnamed player, as the table does', () => {
    expect(cell('Strongest player', [], [player(null, 3, 58000)])?.value).toBe('UID 58000');
    expect(cell('Strongest player', [], [player(null, 3)])?.value).toBe('Unnamed');
  });
});
