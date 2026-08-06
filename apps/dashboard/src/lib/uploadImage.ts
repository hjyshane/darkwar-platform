import { SUPABASE_URL } from './env';
import { supabase } from './supabase';

/** Putting a picture in the `post-images` bucket (0082).
 *
 * THE BUCKET IS PUBLIC. Anything uploaded here can be fetched by anybody with the
 * URL — that is what makes Discord able to show it in the channel, and it is the
 * reason the checks below are about what the file IS rather than only about who is
 * uploading it. A roster screenshot put here is published to the internet; the
 * editor says so next to the button.
 *
 * The limits are enforced twice on purpose. Storage holds the real ones (bucket
 * `file_size_limit` and `allowed_mime_types`, which a hand-written request cannot
 * skip); these exist so a member who picks a 12MB photo is told immediately in
 * words, rather than after a slow upload fails with a status code.
 */
export const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** 5 MB, the same figure as the bucket. Kept in step by hand — Storage does not
 * publish the limit to the client, and a client guessing higher would only send
 * a doomed request. */
export const MAX_BYTES = 5_242_880;

/** The extension for a type, taken from the TYPE rather than the filename.
 *
 * A filename is whatever the uploader's machine happened to call it —
 * `screenshot.png.exe` is a legal name — and the stored object should not carry a
 * claim we did not check. The browser sniffs the type; this maps it. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Why this file cannot be uploaded, or null when it can.
 *
 * A sentence rather than a code, because it goes on screen. Pure, so the reasons
 * can be tested without a browser or a bucket.
 */
export function whyNot(file: { type: string; size: number }): string | null {
  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    // Named individually: "unsupported file type" leaves somebody trying a second
    // wrong format. SVG is called out because it is the one a designer would reach
    // for and the one the bucket refuses on purpose — an SVG can carry script, and
    // on a public bucket that is script served from our own origin.
    return file.type === 'image/svg+xml'
      ? 'SVG cannot be uploaded — it can carry script, and this bucket is public. Export it as PNG.'
      : 'Only PNG, JPEG, WebP and GIF images can be uploaded.';
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1_048_576).toFixed(1);
    return `That file is ${mb}MB. The limit is 5MB — a screenshot should be well under it.`;
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}

/** Where the object goes: `<uploader uuid>/<random uuid>.<ext>`.
 *
 * The folder is the uploader because 0082's policies compare against it, and
 * because it keeps "who put this here" answerable from the name alone after the
 * guide that used the image has been edited or deleted.
 *
 * The filename is random, NOT the original. Two people uploading `image.png` must
 * not collide, and the uploader's own filename can carry anything — a name, a
 * path, a date they did not mean to publish on a public bucket.
 */
export function objectPath(userId: string, type: string): string {
  const extension = EXTENSIONS[type] ?? 'bin';
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

/** The public URL for a stored object. Built here rather than taken from the
 * upload response so it matches what `isSafeImageSrc` will accept — the two agree
 * by construction instead of by coincidence. */
export function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/post-images/${path}`;
}

/** Upload, and return the URL to put in the body.
 *
 * Throws with a readable message. The caller is a button, and a button has
 * somewhere to show a sentence.
 */
export async function uploadPostImage(file: File): Promise<string> {
  const refusal = whyNot(file);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId === undefined) {
    throw new Error('You are signed out. Sign in again and retry the upload.');
  }
  const path = objectPath(userId, file.type);
  const { error } = await supabase.storage.from('post-images').upload(path, file, {
    contentType: file.type,
    // No overwriting. The name is a fresh uuid every time, so an upsert could only
    // ever mask a bug — and masking it would overwrite an image another guide is
    // still using.
    upsert: false,
  });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  return publicUrl(path);
}
