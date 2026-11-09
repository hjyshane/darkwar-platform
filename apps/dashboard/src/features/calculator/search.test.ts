import { describe, expect, it } from 'vitest';
import { filterSubjects, matchesSubject } from './search';

const BANK = { name: 'Bank', nameKo: '은행' };
const WAREHOUSE = { name: 'Warehouse', nameKo: null };

describe('matchesSubject', () => {
  it('matches the English name without regard to case', () => {
    expect(matchesSubject(BANK, 'bAnK')).toBe(true);
    expect(matchesSubject(WAREHOUSE, 'house')).toBe(true);
  });

  it('matches the Korean name, composed or decomposed', () => {
    expect(matchesSubject(BANK, '은행')).toBe(true);
    expect(matchesSubject(BANK, '은행'.normalize('NFD'))).toBe(true);
  });

  it('matches everything on a blank query and nothing on a stranger', () => {
    expect(matchesSubject(WAREHOUSE, '   ')).toBe(true);
    expect(matchesSubject(WAREHOUSE, '은행')).toBe(false);
  });
});

describe('filterSubjects', () => {
  it('keeps order and drops what does not match', () => {
    expect(filterSubjects([WAREHOUSE, BANK], '은')).toEqual([BANK]);
    expect(filterSubjects([WAREHOUSE, BANK], '')).toEqual([WAREHOUSE, BANK]);
  });
});
