import type { Json } from '@dw/shared-types';
import { supabase } from './supabase';

/** A setting as the alliance on screen sees it (0195, 0200).
 *
 * `alliance_setting` returns that alliance's own value, or the shared row the
 * primary's values live in. A signed-out reader cannot call it (0198) and has
 * no alliance on screen anyway, so for them it is the shared row — what every
 * one of these readers did before the settings split.
 *
 * Null when there is nothing saved, which every caller already treats as "use
 * the default".
 */
export async function fetchAllianceSetting(key: string): Promise<Json | null> {
  const { data, error } = await supabase.rpc('alliance_setting', { p_key: key });
  if (!error) {
    return data ?? null;
  }
  if (error.code !== '42501') {
    throw new Error(`${key} setting query failed: ${error.message}`);
  }
  const shared = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (shared.error) {
    if (shared.error.code === '42501') {
      return null;
    }
    throw new Error(`${key} setting query failed: ${shared.error.message}`);
  }
  return shared.data?.value ?? null;
}

/** Save a setting for the alliance on screen. The database decides where it
 *  lands — the shared row for the primary, an override for anybody else — and
 *  refuses a key that is not per-alliance. */
export async function saveAllianceSetting(key: string, value: unknown): Promise<void> {
  // Json is a type alias the interfaces these settings are written as do not
  // satisfy (no index signature); what is enforced is the parser on the read side.
  const { error } = await supabase.rpc('save_alliance_setting', {
    p_key: key,
    p_value: value as Json,
  });
  if (error) {
    throw new Error(error.message);
  }
}
