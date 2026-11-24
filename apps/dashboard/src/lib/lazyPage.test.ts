import { describe, expect, it, vi } from 'vitest';
import { reloadOnceForStaleChunk } from './lazyPage';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('reloadOnceForStaleChunk', () => {
  it('reloads a tab whose screen file is gone after a release', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(memoryStorage(), 1_000_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload again straight after, so a file missing from the release itself cannot loop', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForStaleChunk(storage, 1_000_000, reload);
    expect(reloadOnceForStaleChunk(storage, 1_010_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads again for a later release', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    reloadOnceForStaleChunk(storage, 1_000_000, reload);
    expect(reloadOnceForStaleChunk(storage, 1_000_000 + 60 * 60_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when the tab cannot record that it did', () => {
    const reload = vi.fn();
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(reloadOnceForStaleChunk(refusing, 1_000_000, reload)).toBe(false);
    expect(reloadOnceForStaleChunk(null, 1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
