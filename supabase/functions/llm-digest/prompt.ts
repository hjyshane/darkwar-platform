// The prompt is code: a change here is a reviewed diff and a new PROMPT_VERSION, and old
// drafts keep the version they were written with (never rewritten).

export const PROMPT_VERSION = 'weekly-digest/1';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const SYSTEM = `You write a short weekly digest of an alliance's rank period for its officers, in Korean.

You are given FACTS as JSON. Rules, all of them strict:
- Use ONLY numbers that appear in the FACTS. Never compute a new number (no sums, differences, percentages). If a figure you want is not in the FACTS, leave it out.
- Wrap EVERY player name in double square brackets, exactly as it appears in the FACTS: [[Name]]. Never mention a player who is not in the FACTS.
- Tier labels are R1, R2, R3 as given. A member with tier_reason "offline" was placed in R1 by the offline rule, not by score: say so when you mention one.
- If a list is marked truncated, say it is a partial list.
- Do not guess causes, do not praise or blame, do not recommend promotions, demotions or any action. Report what changed.
- 6 to 12 lines. Plain text, no headings, no tables.`;

export function buildUser(facts: unknown): string {
  return `FACTS:\n${JSON.stringify(facts)}`;
}

export function buildRetryNote(problems: string[]): string {
  return `Your draft was rejected by an automatic check:\n${problems.map((p) => `- ${p}`).join('\n')}\nWrite it again using only what the FACTS contain.`;
}
