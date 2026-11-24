// Edge Function: translate one notice, guide or comment into the reader's
// language, on their request (migration 0349 says why and what is stored).
//
//   POST { kind: 'notice' | 'guide' | 'comment', id: uuid, language: 'ko' | … }
//   with the reader's JWT. Returns { title?, body, cached }.
//
//   source  <- read AS THE READER (their JWT), so RLS decides what they may
//              have translated; a post they cannot read is a 404 here too.
//   cache   <- public.content_translations, service role, keyed by the sha-256
//              of the source text; an edited post no longer matches.
//   limit   <- app_settings site.translation_daily_limit (0 = off), counted on
//              the rows this reader caused to be written in the last 24 hours.
//   model   <- Claude (TRANSLATE_MODEL, default claude-opus-5-5) at low effort,
//              with server-side fallback on a refusal.
//
// Deploy (owner's step):
//   supabase secrets set ANTHROPIC_API_KEY=...     # never in the repo, never a VITE_ variable
//   supabase functions deploy translate
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type Field,
  type Kind,
  dailyLimit,
  fieldsOf,
  parseRequest,
  sourceHash,
  systemPrompt,
} from './core.ts';

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

const DEFAULT_MODEL = 'claude-opus-5-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const auth = req.headers.get('authorization');
  if (!auth) return json(401, { error: 'sign in first' });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'translation is not set up' });
  const model = Deno.env.get('TRANSLATE_MODEL') ?? DEFAULT_MODEL;

  const request = parseRequest(await req.json().catch(() => null));
  if (typeof request === 'string') return json(400, { error: request });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const headers: Record<string, string> = { Authorization: auth };
  const alliance = req.headers.get('x-alliance-id');
  if (alliance) headers['x-alliance-id'] = alliance;
  const asReader = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers },
    auth: { persistSession: false },
  });
  const asService = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  const { data: who } = await asReader.auth.getUser();
  const userId = who.user?.id;
  if (!userId) return json(401, { error: 'sign in first' });

  // The source, through the reader's RLS.
  const source = await readSource(asReader, request.kind, request.id);
  if (source === null) return json(404, { error: 'nothing to translate' });

  // What is already translated from exactly this text.
  const fields = fieldsOf(request.kind).filter((field) => (source[field] ?? '').trim() !== '');
  const hashes = Object.fromEntries(
    await Promise.all(fields.map(async (f) => [f, await sourceHash(source[f] ?? '')] as const)),
  ) as Record<Field, string>;
  const cached = await asService
    .from('content_translations')
    .select('field, source_hash, translated')
    .eq('kind', request.kind)
    .eq('source_id', request.id)
    .eq('language', request.language);
  if (cached.error) return json(500, { error: cached.error.message });
  const result: Partial<Record<Field, string>> = {};
  for (const row of cached.data ?? []) {
    const field = row.field as Field;
    if (hashes[field] === row.source_hash) result[field] = row.translated;
  }
  const missing = fields.filter((field) => result[field] === undefined);
  if (missing.length === 0) return json(200, { ...result, cached: true });

  // The reader's daily limit, counted on what they caused to be written.
  const setting = await asService
    .from('app_settings')
    .select('value')
    .eq('key', 'site.translation_daily_limit')
    .maybeSingle();
  const limit = dailyLimit(setting.data?.value);
  if (limit === 0) return json(403, { error: 'translation is switched off' });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const used = await asService
    .from('content_translations')
    .select('source_id', { count: 'exact', head: true })
    .eq('requested_by', userId)
    .gte('created_at', since);
  if ((used.count ?? 0) + missing.length > limit) {
    return json(429, { error: 'daily translation limit reached' });
  }

  const client = new Anthropic({ apiKey });
  try {
    await Promise.all(
      missing.map(async (field) => {
        const text = await translate(client, model, request.language, field, source[field] ?? '');
        result[field] = text;
        const written = await asService.from('content_translations').upsert({
          kind: request.kind,
          source_id: request.id,
          field,
          language: request.language,
          source_hash: hashes[field],
          translated: text,
          model,
          requested_by: userId,
          created_at: new Date().toISOString(),
        });
        if (written.error) throw new Error(written.error.message);
      }),
    );
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : String(error) });
  }
  return json(200, { ...result, cached: false });
});

async function readSource(
  // biome-ignore lint/suspicious/noExplicitAny: the generated Database type is not available to the function
  db: any,
  kind: Kind,
  id: string,
): Promise<Partial<Record<Field, string>> | null> {
  if (kind === 'notice') {
    const { data } = await db
      .from('announcements')
      .select('title, body')
      .eq('announcement_id', id)
      .maybeSingle();
    return data ?? null;
  }
  if (kind === 'guide') {
    const { data } = await db.from('guides').select('title, body').eq('guide_id', id).maybeSingle();
    return data ?? null;
  }
  const { data } = await db
    .from('post_comments')
    .select('body, deleted_at')
    .eq('comment_id', id)
    .maybeSingle();
  return data === null || data.deleted_at !== null ? null : { body: data.body };
}

async function translate(
  client: Anthropic,
  model: string,
  language: Parameters<typeof systemPrompt>[0],
  field: Field,
  text: string,
): Promise<string> {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    // A refusal on the main model is retried on a fallback inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Translation is not hard reasoning: low effort keeps it fast and cheap.
    output_config: { effort: 'low' },
    system: systemPrompt(language, field),
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new Error('the model declined to translate this');
  if (response.stop_reason === 'max_tokens') throw new Error('the text is too long to translate');
  const out = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  if (out === '') throw new Error('the model returned nothing');
  return out;
}
