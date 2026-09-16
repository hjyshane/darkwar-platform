import { expect, test } from 'vitest';
import { rpcFailureMessage } from '../src/features/admin/RankReportSetting';

// The exact PostgrestError the Rebuild button produced on 2026-09-15. Pressing
// it again worked, so the sentence has to say "again", not "failed".
const timeout = {
  code: '57014',
  message: 'canceling statement due to statement timeout',
};

test('a timeout says the database was busy and to press again', () => {
  const said = rpcFailureMessage(timeout);
  expect(said).not.toBe(timeout.message);
  expect(said).toMatch(/again/i);
  expect(said).toMatch(/busy/i);
});

// The half an officer acts on: a timed-out statement is rolled back whole, so
// the previous answer is still standing and no announcement went out.
test('a timeout says nothing was written', () => {
  expect(rpcFailureMessage(timeout)).toMatch(/nothing was written/i);
});

// PostgREST is the part that gets reworded; the SQLSTATE is not. A response
// carrying 57014 is a timeout whatever the sentence says.
test('the SQLSTATE alone is enough', () => {
  expect(rpcFailureMessage({ code: '57014', message: 'a wording nobody expected' })).toMatch(
    /again/i,
  );
});

// And the reverse, for a client that drops the code — the supabase-js error
// shape is not guaranteed to carry one on every transport failure.
test('the text alone is enough', () => {
  expect(rpcFailureMessage({ message: 'canceling statement due to statement timeout' })).toMatch(
    /again/i,
  );
});

// EVERY OTHER FAILURE IS PASSED THROUGH UNTOUCHED. `officers only` and a
// permission refusal are the officer's answer, not noise to be softened — and
// rewriting them would hide the two errors this screen is most likely to show
// to somebody who should not be pressing the button.
test('other errors are left exactly as the database worded them', () => {
  expect(rpcFailureMessage({ code: '42501', message: 'officers only' })).toBe('officers only');
  expect(rpcFailureMessage({ code: 'PGRST202', message: 'function not found' })).toBe(
    'function not found',
  );
  expect(rpcFailureMessage({ code: null, message: 'network error' })).toBe('network error');
});

// A timeout on a DIFFERENT statement is still a timeout. Guard against the
// matcher being narrowed to the RPC's own wording later.
test('a timeout mentioned mid-sentence still matches', () => {
  expect(
    rpcFailureMessage({ message: 'error: canceling statement due to statement timeout (57014)' }),
  ).toMatch(/again/i);
});
