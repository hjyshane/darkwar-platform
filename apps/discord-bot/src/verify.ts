/** Proving a request really came from Discord.
 *
 * THIS IS THE ONLY THING STANDING BETWEEN THE BOT AND THE OPEN INTERNET. The
 * interactions endpoint is a public URL with no session and no API key —
 * anybody can POST to it. What makes a request trustworthy is the Ed25519
 * signature Discord puts on it, checked against the application's public key.
 *
 * Discord tests this before it will save the endpoint URL: it deliberately
 * sends requests with bad signatures and expects 401. An endpoint that answers
 * 200 to those is rejected, which is a rare case of the platform enforcing the
 * security property for you.
 *
 * The signature covers `timestamp + rawBody`, so the body must be verified as
 * the exact bytes that arrived. Parsing to JSON and re-serialising changes key
 * order and whitespace and the signature stops matching — so `index.ts` reads
 * the body as text, verifies, and only then parses.
 */

const ED25519 = { name: 'Ed25519' } as const;

/** Hex to bytes, or null when the input is not clean hex.
 *
 * Returns null rather than throwing because every caller here is deciding
 * "is this request genuine", and a malformed header is simply a no — not an
 * exceptional condition worth a stack trace on a public endpoint.
 *
 * Returns an ArrayBuffer rather than a Uint8Array because TypeScript 5.9 made
 * typed arrays generic over their backing buffer, and `Uint8Array<ArrayBufferLike>`
 * — what every ordinary constructor produces — is not a `BufferSource`. Owning
 * the buffer explicitly is clearer than casting the mismatch away at each of
 * the three WebCrypto calls.
 */
function fromHex(hex: string): ArrayBuffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return buffer;
}

/** The signed message: the timestamp and the raw body, as bytes. */
function messageBytes(timestamp: string, rawBody: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(timestamp + rawBody);
  const buffer = new ArrayBuffer(encoded.length);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

/** Does this signature prove Discord sent this body?
 *
 * Never throws. A malformed key, a malformed signature, and a valid signature
 * over different bytes are all the same answer to the caller: false.
 */
export async function verifySignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  const publicKey = fromHex(publicKeyHex);
  const signature = fromHex(signatureHex);
  if (publicKey === null || signature === null || timestamp === '') {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey('raw', publicKey, ED25519, false, ['verify']);
    return await crypto.subtle.verify(ED25519, key, signature, messageBytes(timestamp, rawBody));
  } catch {
    // importKey rejects a wrong-length key, verify rejects a wrong-length
    // signature. Both mean the request is not from Discord.
    return false;
  }
}
