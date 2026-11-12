// Edge Function: weekly digest draft. POST { period_start?: string } with the officer's JWT.
//
//   facts   <- public.llm_digest_facts(), called AS THE CALLER (their JWT, their x-alliance-id),
//              so RLS decides what the model can be shown.
//   model   <- Anthropic Messages API, key from the ANTHROPIC_API_KEY function secret.
//   check   <- grounding.ts; one retry; a second rejection stores nothing.
//   draft   <- public.llm_drafts, inserted as the officer (policy: officer_insert).
//
// Gate: app_settings key 'llm_digest' {"enabled": bool, "daily_cap": int}; absent = off.
// Nothing here writes anywhere but llm_drafts, and nothing reads a draft back into state.
//
// Deploy (owner's step; needs the secret first):
//   supabase secrets set ANTHROPIC_API_KEY=...        # never in the repo, never a VITE_ variable
//   supabase functions deploy llm-digest
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type CallModel, factsHash, runDigest } from './digest.ts';
import { DEFAULT_MODEL, PROMPT_VERSION } from './prompt.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-alliance-id',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const auth = req.headers.get('authorization');
  if (!auth) return json(401, { error: 'sign in first' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'ANTHROPIC_API_KEY is not set' });
  const model = Deno.env.get('LLM_DIGEST_MODEL') ?? DEFAULT_MODEL;

  const headers: Record<string, string> = { Authorization: auth };
  const alliance = req.headers.get('x-alliance-id');
  if (alliance) headers['x-alliance-id'] = alliance;
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers },
      auth: { persistSession: false },
    },
  );

  const body = await req.json().catch(() => ({}));
  const period = typeof body?.period_start === 'string' ? body.period_start : null;

  // Gate: off unless an admin turned it on; and a per-day cap on drafts in this alliance.
  const gate = await db.from('app_settings').select('value').eq('key', 'llm_digest').maybeSingle();
  const cfg = (gate.data?.value ?? {}) as { enabled?: boolean; daily_cap?: number };
  if (!cfg.enabled) return json(403, { error: 'llm_digest is switched off' });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const used = await db
    .from('llm_drafts')
    .select('draft_id', { count: 'exact', head: true })
    .gte('created_at', since);
  if ((used.count ?? 0) >= (cfg.daily_cap ?? 0)) return json(429, { error: 'daily cap reached' });

  // Facts, through the caller's RLS. A member gets 42501 here and we stop.
  const facts = await db.rpc('llm_digest_facts', { p_period_start: period });
  if (facts.error)
    return json(facts.error.code === '42501' ? 403 : 500, { error: facts.error.message });

  const callModel: CallModel = async (system, messages) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
    });
    if (!res.ok) throw new Error(`model API ${res.status}`);
    const data = await res.json();
    return (data.content ?? []).map((b: { text?: string }) => b.text ?? '').join('');
  };

  let result: Awaited<ReturnType<typeof runDigest>>;
  try {
    result = await runDigest(facts.data, callModel);
  } catch (e) {
    return json(502, { error: String(e instanceof Error ? e.message : e) });
  }
  if (!result.ok)
    return json(422, { error: 'draft failed the grounding check', problems: result.problems });

  const hash = await factsHash(facts.data);
  const inserted = await db
    .from('llm_drafts')
    .insert({
      kind: 'weekly_digest',
      period_start: facts.data?.period_start ?? null,
      facts: facts.data,
      facts_hash: hash,
      prompt_version: PROMPT_VERSION,
      model,
      output: result.text,
    })
    .select('draft_id')
    .single();
  if (inserted.error) return json(500, { error: inserted.error.message });

  return json(200, {
    draft_id: inserted.data.draft_id,
    text: result.text,
    attempts: result.attempts,
  });
});
