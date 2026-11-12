// Run: node --test supabase/functions/llm-digest/   (Node 22+, built-in type stripping)
import assert from 'node:assert/strict';
import test from 'node:test';
import { factsHash, runDigest } from './digest.ts';
import { checkGrounding } from './grounding.ts';

const facts = {
  facts_version: 1,
  period_start: '2026-10-26T02:00:00+00:00',
  member_count: 3,
  tiers: { R1: 1, R2: 1, R3: 1 },
  offline_demotions: 1,
  tier_changes: {
    count: 2,
    truncated: false,
    items: [
      { name: 'Bob', from_tier: 'R3', to_tier: 'R2', tier_reason: 'score' },
      { name: 'Cara', from_tier: 'R2', to_tier: 'R1', tier_reason: 'offline' },
    ],
  },
  top_power_growth: [{ name: 'Alice', power_growth: 1234567 }],
};

test('a draft built only from the facts passes', () => {
  const text =
    '10월 26일 기간, 멤버 3명. [[Bob]]은 R3에서 R2로, [[Cara]]는 R2에서 R1로 내려갔고 offline 규칙이 1건입니다.\n' +
    '1. 전투력 성장 1위 [[Alice]] 1,234,567';
  assert.deepEqual(checkGrounding(text, facts), { ok: true, problems: [] });
});

test('an invented number is rejected', () => {
  const r = checkGrounding('멤버 99명이 있습니다.', facts);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /number not in facts: 99/);
});

test('a computed number is rejected (3 + 2 = 5 is not in the facts)', () => {
  assert.equal(checkGrounding('총 5건의 변화', facts).ok, false);
});

test('an invented player name is rejected', () => {
  const r = checkGrounding('[[Mallory]]가 승급했습니다.', facts);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /name not in facts: Mallory/);
});

test('digits inside a bracketed name and tier labels are not claims', () => {
  const f = { ...facts, top_power_growth: [{ name: 'Player777', power_growth: 5 }] };
  assert.equal(checkGrounding('[[Player777]]은 R2, 5 증가', f).ok, true);
});

test('runDigest accepts a good first draft', async () => {
  const r = await runDigest(facts, async () => '멤버 3명, [[Bob]] R2');
  assert.deepEqual(r, { ok: true, text: '멤버 3명, [[Bob]] R2', attempts: 1 });
});

test('runDigest retries once with the problems and accepts the fix', async () => {
  const seen: string[] = [];
  const drafts = ['멤버 99명', '멤버 3명'];
  const r = await runDigest(facts, async (_s, messages) => {
    seen.push(messages.at(-1)?.content ?? '');
    return drafts.shift() ?? '';
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.match(seen[1], /number not in facts: 99/);
});

test('runDigest gives up after the retry and stores nothing', async () => {
  const r = await runDigest(facts, async () => '멤버 99명');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.problems.join(), /99/);
});

test('an empty draft is a failure, not a pass', async () => {
  const r = await runDigest(facts, async () => '   ');
  assert.equal(r.ok, false);
});

test('facts hash ignores key order', async () => {
  assert.equal(
    await factsHash({ a: 1, b: { c: 2, d: 3 } }),
    await factsHash({ b: { d: 3, c: 2 }, a: 1 }),
  );
  assert.notEqual(await factsHash({ a: 1 }), await factsHash({ a: 2 }));
});
