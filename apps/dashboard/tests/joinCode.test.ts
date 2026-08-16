// The state function mirrors the conditions redeem_join_code() checks
// (0021). If it drifts, this screen starts telling an admin a code works
// while the database refuses it — which is worse than not showing a state
// at all.
import { expect, test } from 'vitest';
import {
  type CodeState,
  cleanCodePart,
  codeState,
  generateJoinCode,
  isCodeComplete,
  joinCodeFrom,
  splitPastedCode,
  usesLeft,
} from '../src/lib/joinCode';

const NOW = new Date('2026-08-03T12:00:00Z');

function code(over: Partial<Parameters<typeof codeState>[0]> = {}) {
  return { revoked_at: null, expires_at: null, max_uses: null, used_count: 0, ...over };
}

test('a fresh code with no limits is active', () => {
  expect(codeState(code(), NOW)).toBe('active');
});

test('a revoked code says revoked even when it would otherwise still work', () => {
  expect(codeState(code({ revoked_at: '2026-08-01T00:00:00Z' }), NOW)).toBe('revoked');
});

test('revoked wins over expired, because that is the fact somebody acted on', () => {
  const both = code({ revoked_at: '2026-08-01T00:00:00Z', expires_at: '2026-08-02T00:00:00Z' });
  expect(codeState(both, NOW)).toBe('revoked');
});

test('expiry is exclusive at the boundary, like the SQL', () => {
  // redeem_join_code() takes `expires_at > now()`, so the moment itself is
  // already too late.
  expect(codeState(code({ expires_at: '2026-08-03T12:00:00Z' }), NOW)).toBe('expired');
  expect(codeState(code({ expires_at: '2026-08-03T12:00:01Z' }), NOW)).toBe('active');
});

test('a code is used up once the count reaches the limit', () => {
  expect(codeState(code({ max_uses: 2, used_count: 1 }), NOW)).toBe('active');
  expect(codeState(code({ max_uses: 2, used_count: 2 }), NOW)).toBe('used up');
});

test('no limit means it never runs out', () => {
  expect(codeState(code({ used_count: 999 }), NOW)).toBe('active');
  expect(usesLeft(code({ used_count: 999 }))).toBeNull();
});

test('uses left never goes negative', () => {
  // A race could redeem past the limit; showing "-1 left" would be a bug
  // report about arithmetic instead of about the race.
  expect(usesLeft(code({ max_uses: 2, used_count: 3 }))).toBe(0);
});

test('every state is reachable', () => {
  const seen = new Set<CodeState>([
    codeState(code(), NOW),
    codeState(code({ revoked_at: '2026-08-01T00:00:00Z' }), NOW),
    codeState(code({ expires_at: '2026-08-01T00:00:00Z' }), NOW),
    codeState(code({ max_uses: 1, used_count: 1 }), NOW),
  ]);
  expect(seen).toEqual(new Set(['active', 'revoked', 'expired', 'used up']));
});

test('a generated code avoids the characters people mishear', () => {
  // 0/O, 1/I/L, 2/Z, 5/S, 8/B. These get read out over voice chat.
  for (let i = 0; i < 200; i += 1) {
    expect(generateJoinCode()).not.toMatch(/[0O1IL2Z5S8B]/);
  }
});

test('a generated code is grouped, and long enough to be worth generating', () => {
  const value = generateJoinCode();
  expect(value).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  expect(value.replace('-', '')).toHaveLength(10);
});

test('two codes in a row differ', () => {
  const many = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
  expect(many.size).toBe(50);
});

test('a typed code half is folded to the alphabet it was generated from', () => {
  // Lowercase is a typing choice, never a different code: every issued code
  // comes from the uppercase alphabet, and redeem_join_code compares with `=`.
  expect(cleanCodePart('acdef')).toBe('ACDEF');
  // Characters the alphabet deliberately excludes are dropped rather than
  // rejected — O/0 and I/1 are exactly what a person mistypes reading aloud.
  expect(cleanCodePart('AC-DE')).toBe('ACDE');
  expect(cleanCodePart('ACDEFGH')).toBe('ACDEF');
});

test('pasting a whole code fills both halves', () => {
  // The common case: it arrives in a Discord message as one string.
  expect(splitPastedCode('ACDEF-GHJKM')).toEqual(['ACDEF', 'GHJKM']);
  expect(splitPastedCode('acdef-ghjkm')).toEqual(['ACDEF', 'GHJKM']);
  expect(splitPastedCode('ACDEF')).toEqual(['ACDEF', '']);
});

test('the two halves rejoin as the string the function expects', () => {
  expect(joinCodeFrom('acdef', 'ghjkm')).toBe('ACDEF-GHJKM');
  expect(isCodeComplete('ACDEF', 'GHJKM')).toBe(true);
  expect(isCodeComplete('ACDE', 'GHJKM')).toBe(false);
  expect(isCodeComplete('', '')).toBe(false);
});

test('a generated code survives the round trip through the two boxes', () => {
  // The assertion that ties the pair together: whatever the generator emits
  // must come back byte-identical after being split and rejoined, or a member
  // burns an attempt against a five-try lockout.
  const generated = generateJoinCode();
  const [a, b] = splitPastedCode(generated);
  expect(joinCodeFrom(a, b)).toBe(generated);
});
