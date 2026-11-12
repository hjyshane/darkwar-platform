// Orchestration with the model injected, so tests run with a fake and CI makes no network call.
import { checkGrounding } from './grounding.ts';
import { SYSTEM, buildRetryNote, buildUser } from './prompt.ts';

export type Turn = { role: 'user' | 'assistant'; content: string };
export type CallModel = (system: string, messages: Turn[]) => Promise<string>;

export type DigestResult =
  | { ok: true; text: string; attempts: number }
  | { ok: false; problems: string[]; attempts: number };

/** One draft, one retry. A second rejection is returned as a failure; nothing is stored. */
export async function runDigest(
  facts: unknown,
  callModel: CallModel,
  maxAttempts = 2,
): Promise<DigestResult> {
  const messages: Turn[] = [{ role: 'user', content: buildUser(facts) }];
  let problems: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = (await callModel(SYSTEM, messages)).trim();
    const verdict = checkGrounding(text, facts as never);
    if (verdict.ok && text.length > 0) return { ok: true, text, attempts: attempt };
    problems = text.length === 0 ? ['empty draft'] : verdict.problems;
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: buildRetryNote(problems) });
  }
  return { ok: false, problems, attempts: maxAttempts };
}

/** Canonical JSON (sorted keys) -> SHA-256 hex. The same facts always hash the same. */
export async function factsHash(facts: unknown): Promise<string> {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v;
  const bytes = new TextEncoder().encode(JSON.stringify(canon(facts)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
