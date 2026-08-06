import { useQuery } from '@tanstack/react-query';
import { SUPABASE_URL } from './env';
import { supabase } from './supabase';

/** Fetching a picture out of a bucket that is no longer public (0083).
 *
 * An `<img>` cannot send an Authorization header, so a private object cannot be
 * put in a `src` directly. The only way a browser fetches one is a SIGNED URL —
 * a short-lived token in the query string, which Storage mints for a caller whose
 * session RLS already allows (`post_images_read`).
 *
 * WHY THE BODY STILL STORES THE PUBLIC-SHAPED URL. `![alt](…/object/public/post-images/x.png)`
 * is what the editor writes and what `isSafeImageSrc` allows, and it stays that
 * way: it is a stable NAME for the object rather than a working address. A signed
 * URL cannot be stored — it expires, and a guide written in August would show
 * broken pictures in September. So the text names the object and the renderer signs
 * it at the moment somebody looks.
 */
const BUCKET = 'post-images';
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

/** An hour. Long enough that a reader scrolling a guide never sees a link expire
 * under them, short enough that a URL copied out of the page stops working before
 * it can be passed around — which is the difference this whole change is for. */
export const SIGNED_TTL_SECONDS = 3600;

/** The object's path inside the bucket, or null when the URL does not name one.
 *
 * Pure, and the reason this file is testable: everything that can go wrong here is
 * a URL shape, not a network call.
 */
export function objectPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith(PUBLIC_PREFIX)) {
    return null;
  }
  const path = trimmed.slice(PUBLIC_PREFIX.length);
  // A path that climbs, or an empty one, is not an object. `isSafeImageSrc`
  // refuses these too; repeating it costs nothing and this function is called
  // from a component that has no other guard.
  if (path === '' || path.includes('..')) {
    return null;
  }
  return path;
}

/** A usable `src` for one image in a post body.
 *
 * Keyed on the path, so two guides showing the same picture sign it once. Refetched
 * a little before the token dies rather than on a timer: a page left open for an
 * afternoon otherwise fills with broken images, and the reader's conclusion would
 * be that the upload failed.
 */
export function useSignedImage(url: string) {
  const path = objectPathFromUrl(url);
  return useQuery({
    queryKey: ['signed-image', path],
    enabled: path !== null,
    // Five minutes before expiry, so a render that happens to land on the boundary
    // still gets a token with time left on it.
    staleTime: (SIGNED_TTL_SECONDS - 300) * 1000,
    refetchInterval: (SIGNED_TTL_SECONDS - 300) * 1000,
    queryFn: async (): Promise<string | null> => {
      if (path === null) {
        return null;
      }
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_TTL_SECONDS);
      if (error) {
        throw new Error(`could not sign ${path}: ${error.message}`);
      }
      return data?.signedUrl ?? null;
    },
  });
}
