/** The Worker. A public URL Discord POSTs interactions to.
 *
 * WHY A WORKER AND NOT THE COLLECTOR. The collector is a Windows process tree
 * on one desk; a bot living there is offline whenever that machine is. An
 * interactions endpoint is HTTP request/response with no gateway socket to
 * hold open, which is exactly what a Worker is good at.
 *
 * WHY THIS DOES NOT CONTRADICT `apps/dashboard/wrangler.jsonc`. That file
 * refuses a Worker in front of the dashboard's static assets, on the grounds
 * that it would be a second place for auth to be wrong. This Worker is a
 * separate deployment that sits in front of nothing — the dashboard does not
 * route through it and it holds no Supabase credential at all.
 *
 * There is no Supabase client here on purpose. Every command answers from a
 * table compiled into the bundle, so the bot has nothing to leak: the only
 * secret it holds is Discord's own public key, which is not secret.
 */

import { isInteraction } from './interaction.ts';
import { handleInteraction } from './router.ts';

export interface Env {
  /** From the Discord developer portal, General Information. Not a secret —
   *  it verifies signatures, it does not create them — but it is configuration
   *  and does not belong in the source. */
  readonly DISCORD_PUBLIC_KEY: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      // A browser visiting the endpoint. Deliberately says nothing about what
      // lives here.
      return new Response('Method not allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    if (signature === null || timestamp === null) {
      return new Response('Missing signature', { status: 401 });
    }

    // AS TEXT, BEFORE PARSING. The signature covers the exact bytes; parsing
    // and re-serialising changes key order and whitespace, and then nothing
    // verifies. This ordering is the whole reason `verifySignature` takes a
    // string rather than an object.
    const rawBody = await request.text();

    // Imported lazily so a Worker cold start does not pay for the crypto
    // module on the 405 path above.
    const { verifySignature } = await import('./verify.ts');
    const genuine = await verifySignature(env.DISCORD_PUBLIC_KEY, signature, timestamp, rawBody);
    if (!genuine) {
      // 401 IS REQUIRED, NOT A PREFERENCE. Discord sends deliberately bad
      // signatures when you save the endpoint URL and refuses the endpoint if
      // it answers anything else.
      return new Response('Invalid request signature', { status: 401 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response('Malformed body', { status: 400 });
    }

    if (!isInteraction(parsed)) {
      return new Response('Not an interaction', { status: 400 });
    }

    return json(handleInteraction(parsed));
  },
};
