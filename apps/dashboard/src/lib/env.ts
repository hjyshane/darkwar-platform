// Fallbacks are the well-known LOCAL stack defaults from `supabase start`.
// The publishable key is browser-safe by design (RLS still applies) and only
// works against a local stack. Real deployments must set VITE_* env vars.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
