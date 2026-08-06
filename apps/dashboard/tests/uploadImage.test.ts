// The bucket is PUBLIC (0082), so what gets into it matters more here than in a
// closed schema. These are the checks a member meets before the upload starts —
// storage holds the real limits, and these exist so a wrong file is refused in
// words rather than by a status code after a slow upload.
import { describe, expect, test } from 'vitest';
import { isSafeImageSrc } from '../src/lib/richText';
import { MAX_BYTES, objectPath, publicUrl, whyNot } from '../src/lib/uploadImage';

describe('whyNot', () => {
  test('a png under the limit is fine', () => {
    expect(whyNot({ type: 'image/png', size: 500_000 })).toBeNull();
  });

  // THE one to get right. An SVG is a document that can carry script, and a
  // browser runs it when the file is opened directly — on a public bucket that is
  // script served from our own origin, handed out by link.
  test('SVG is refused, and says why', () => {
    const refusal = whyNot({ type: 'image/svg+xml', size: 1000 });
    expect(refusal).toContain('script');
    expect(refusal).toContain('PNG');
  });

  test('anything else that is not an allowed image is refused', () => {
    for (const type of ['application/pdf', 'text/html', 'application/octet-stream', '']) {
      expect(whyNot({ type, size: 1000 })).not.toBeNull();
    }
  });

  // The message carries the actual size, because "too big" leaves somebody
  // guessing at how much to compress.
  test('over the limit is refused with the size in it', () => {
    const refusal = whyNot({ type: 'image/png', size: MAX_BYTES + 1 });
    expect(refusal).toContain('5MB');
    expect(refusal).toContain('5.0MB');
  });

  test('exactly the limit is allowed', () => {
    expect(whyNot({ type: 'image/png', size: MAX_BYTES })).toBeNull();
  });

  test('an empty file is refused rather than uploaded as nothing', () => {
    expect(whyNot({ type: 'image/png', size: 0 })).not.toBeNull();
  });
});

describe('objectPath', () => {
  const uid = '11111111-1111-4111-8111-111111111111';

  // The folder is the uploader, which is what 0082's policies compare against.
  test('the uploader is the folder', () => {
    expect(objectPath(uid, 'image/png').startsWith(`${uid}/`)).toBe(true);
  });

  // From the TYPE, not from a filename. A filename is whatever the uploader's
  // machine called it, and the stored object should not carry a claim nobody
  // checked.
  test('the extension comes from the mime type', () => {
    expect(objectPath(uid, 'image/png')).toMatch(/\.png$/);
    expect(objectPath(uid, 'image/jpeg')).toMatch(/\.jpg$/);
    expect(objectPath(uid, 'image/webp')).toMatch(/\.webp$/);
    expect(objectPath(uid, 'image/gif')).toMatch(/\.gif$/);
  });

  // Two people uploading `image.png` must not collide, and one person uploading
  // the same file twice must not overwrite the first — a guide may still be using
  // it.
  test('two uploads never share a name', () => {
    const names = new Set(Array.from({ length: 50 }, () => objectPath(uid, 'image/png')));
    expect(names.size).toBe(50);
  });
});

// The two halves have to agree: a URL this builds must be one the renderer will
// accept, or an upload succeeds and the picture silently renders as text.
describe('publicUrl and isSafeImageSrc', () => {
  test('what we upload is what the renderer will show', () => {
    const url = publicUrl(objectPath('11111111-1111-4111-8111-111111111111', 'image/png'));
    expect(isSafeImageSrc(url)).toBe(true);
  });

  // The privacy rule: an <img src> is fetched by every reader's browser with no
  // click, so an outside host would get a log line per reader — a way to count who
  // opened a guide, which `post_reads` deliberately refuses to answer.
  test('an image hosted anywhere else is not rendered as an image', () => {
    expect(isSafeImageSrc('https://example.invalid/tracker.png')).toBe(false);
    expect(isSafeImageSrc('https://evil.invalid/a.png?x=http://127.0.0.1:54321')).toBe(false);
  });

  test('nor another bucket on our own project', () => {
    expect(
      isSafeImageSrc('http://127.0.0.1:54321/storage/v1/object/public/private-stuff/a.png'),
    ).toBe(false);
  });

  // A prefix check alone would accept a path that walks back out of the bucket.
  test('nor a path that climbs out of the bucket', () => {
    expect(
      isSafeImageSrc('http://127.0.0.1:54321/storage/v1/object/public/post-images/../other/a.png'),
    ).toBe(false);
  });

  test('nor a javascript: or data: url', () => {
    expect(isSafeImageSrc('javascript:alert(1)')).toBe(false);
    expect(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });
});
