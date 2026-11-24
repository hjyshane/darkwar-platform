import { describe, expect, it } from 'vitest';
import { FAILED_MESSAGE, TIMEOUT_MESSAGE, isTimeout, loadErrorText } from './loadError';

describe('isTimeout', () => {
  it('recognises the statement_timeout wording map_atlas raises through PostgREST', () => {
    expect(
      isTimeout(new Error('map query failed: canceling statement due to statement timeout')),
    ).toBe(true);
  });

  it('recognises the SQLSTATE when only that survives', () => {
    expect(isTimeout('57014')).toBe(true);
  });

  it('is not fooled by other failures', () => {
    expect(isTimeout(new Error('map query failed: permission denied'))).toBe(false);
    expect(isTimeout(null)).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
  });
});

describe('loadErrorText', () => {
  it('asks for a refresh on a timeout and hides the database wording', () => {
    expect(
      loadErrorText(new Error('map query failed: canceling statement due to statement timeout')),
    ).toEqual({ message: TIMEOUT_MESSAGE, detail: null });
  });

  it('keeps the detail of any other failure, since that one is worth reporting', () => {
    expect(loadErrorText(new Error('map query failed: permission denied'))).toEqual({
      message: FAILED_MESSAGE,
      detail: 'map query failed: permission denied',
    });
  });

  it('has no detail for an error without words', () => {
    expect(loadErrorText(new Error(''))).toEqual({ message: FAILED_MESSAGE, detail: null });
    expect(loadErrorText({})).toEqual({ message: FAILED_MESSAGE, detail: null });
  });
});
