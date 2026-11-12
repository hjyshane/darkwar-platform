// The grounding check: a draft may only say numbers and names that are in its facts.
//
// This is what makes a model-written digest safe enough to ship. It is deliberately dumb
// and deterministic: no model judges a model. A number the facts do not contain, or a
// player name the facts do not contain, rejects the draft.
//
// Names: the prompt tells the model to wrap every player name in [[double brackets]], and
// this file checks each bracketed name against the names in the facts. (Finding an
// unbracketed invented name would need entity recognition; the brackets turn it into a
// lookup. A name the model forgets to bracket is not checked, which is why the digest is
// a draft an officer reads, never a post.)

export type Grounding = { ok: boolean; problems: string[] };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T/;

function normalize(token: string): string {
  // "1,234" and "1234" and "1234.0" are one number.
  const n = Number(token.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : token;
}

/** Every number the facts contain, as normalized strings, plus date parts of ISO strings. */
export function factNumbers(facts: Json): Set<string> {
  const out = new Set<string>();
  const walk = (v: Json): void => {
    if (typeof v === 'number') out.add(normalize(String(v)));
    else if (typeof v === 'string') {
      const d = ISO_DATE.exec(v);
      if (d) {
        // 2026-10-26 reads "10월 26일" or "Oct 26" - month and day are fair game, unpadded.
        for (const part of [d[1], d[2], d[3]]) out.add(normalize(part));
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Every value under a key called "name", anywhere in the facts. */
export function factNames(facts: Json): Set<string> {
  const out = new Set<string>();
  const walk = (v: Json): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (k === 'name' && typeof child === 'string') out.add(child);
        else walk(child);
      }
    }
  };
  walk(facts);
  return out;
}

export function checkGrounding(output: string, facts: Json): Grounding {
  const problems: string[] = [];
  const numbers = factNumbers(facts);
  const names = factNames(facts);

  const bracketed = [...output.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
  for (const name of bracketed) {
    if (!names.has(name)) problems.push(`name not in facts: ${name}`);
  }

  // Strip what is not a claim: bracketed names (they may contain digits), tier labels,
  // and list markers ("1." at the start of a line).
  const prose = output
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/\bR[1-5]\b/g, ' ')
    .replace(/^\s*\d+[.)]\s/gm, '');

  for (const m of prose.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = normalize(m[0]);
    if (!numbers.has(n)) problems.push(`number not in facts: ${m[0]}`);
  }

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
