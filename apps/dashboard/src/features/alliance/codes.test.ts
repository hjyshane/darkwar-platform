import { describe, expect, it } from 'vitest';
import { LANGUAGES, countryName, languageName } from './codes';

describe('languageName', () => {
  it('resolves the client dictionary keys', () => {
    expect(languageName('391083')).toBe('Traditional Chinese');
    expect(languageName('390758')).toBe('Korean');
  });
  it('shows an unknown key as itself rather than failing', () => {
    expect(languageName('999999')).toBe('999999');
  });
  it('passes null through', () => {
    expect(languageName(null)).toBeNull();
  });
  it('keeps the Korean column the dictionary has', () => {
    expect(LANGUAGES['391083']?.ko).toBe('중국어 (번체)');
  });
});

describe('countryName', () => {
  it('resolves an ISO code in either case', () => {
    expect(countryName('TW')).toBe('Taiwan');
    expect(countryName('tw')).toBe('Taiwan');
  });
  it('shows an unlisted code as itself, uppercased', () => {
    expect(countryName('zz')).toBe('ZZ');
  });
  it('passes null through', () => {
    expect(countryName(null)).toBeNull();
  });
});
