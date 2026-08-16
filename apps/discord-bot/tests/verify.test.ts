/** The signature check, against a real Ed25519 keypair.
 *
 * Nothing is mocked. A mocked `crypto.subtle.verify` would pass whether or not
 * the code passes it the right bytes, and getting the bytes right — timestamp
 * concatenated with the RAW body — is the entire difficulty. So the test
 * generates a key, signs with it, and asks the real implementation.
 *
 * The negative cases matter more than the positive one. Discord itself sends
 * deliberately bad signatures when you save the endpoint and refuses the
 * endpoint if any of them come back verified.
 */

import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/verify';

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyHex = toHex(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, publicKeyHex };
}

async function sign(privateKey: CryptoKey, timestamp: string, body: string): Promise<string> {
  const message = new TextEncoder().encode(timestamp + body);
  return toHex(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, message));
}

describe('verifySignature', () => {
  const timestamp = '1755300000';
  const body = '{"type":1}';

  it('accepts a signature Discord would have produced', async () => {
    const { pair, publicKeyHex } = await keypair();
    const signature = await sign(pair.privateKey, timestamp, body);

    expect(await verifySignature(publicKeyHex, signature, timestamp, body)).toBe(true);
  });

  it('rejects a body that changed after signing', async () => {
    const { pair, publicKeyHex } = await keypair();
    const signature = await sign(pair.privateKey, timestamp, body);

    expect(await verifySignature(publicKeyHex, signature, timestamp, '{"type":2}')).toBe(false);
  });

  it('rejects a replay under a different timestamp', async () => {
    const { pair, publicKeyHex } = await keypair();
    const signature = await sign(pair.privateKey, timestamp, body);

    expect(await verifySignature(publicKeyHex, signature, '1755300001', body)).toBe(false);
  });

  it('rejects a signature from somebody elseentirely', async () => {
    const mine = await keypair();
    const theirs = await keypair();
    const signature = await sign(theirs.pair.privateKey, timestamp, body);

    expect(await verifySignature(mine.publicKeyHex, signature, timestamp, body)).toBe(false);
  });

  // Each of these throws inside WebCrypto if handed straight through, and a
  // throw on a public endpoint is a 500 where Discord requires a 401.
  it.each([
    ['not hex at all', 'zzzz'],
    ['odd length', 'abc'],
    ['empty', ''],
  ])('rejects a malformed signature (%s) without throwing', async (_label, signature) => {
    const { publicKeyHex } = await keypair();

    expect(await verifySignature(publicKeyHex, signature, timestamp, body)).toBe(false);
  });

  it('rejects a malformed public key without throwing', async () => {
    const { pair } = await keypair();
    const signature = await sign(pair.privateKey, timestamp, body);

    expect(await verifySignature('00ff', signature, timestamp, body)).toBe(false);
  });

  it('rejects an empty timestamp', async () => {
    const { pair, publicKeyHex } = await keypair();
    const signature = await sign(pair.privateKey, '', body);

    // Even though the signature is genuine over the empty timestamp: Discord
    // always sends one, so its absence means the request is not from Discord.
    expect(await verifySignature(publicKeyHex, signature, '', body)).toBe(false);
  });
});
