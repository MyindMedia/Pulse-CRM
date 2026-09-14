/* ============================================================
   Secret box: AES-256-GCM for credentials Pulse must keep.

   A Plaid access token is a standing key to a studio's bank feed,
   stronger than anything else Pulse stores. Convex encrypts the
   database at rest, but anyone who can read the database (the
   dashboard, an export, a backup) would read a working token. So
   the token is sealed here with a key that lives only in the
   deployment's environment (PLAID_TOKEN_KEY, base64 of 32 random
   bytes) and opened only inside an internal action, immediately
   before a Plaid call.

   GCM authenticates as well as encrypts: a changed byte or the
   wrong key fails loudly instead of yielding garbage.
   ============================================================ */

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export type Sealed = { ciphertext: string; iv: string };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  const encoded = process.env.PLAID_TOKEN_KEY;
  if (!encoded) throw new SecretBoxError("PLAID_TOKEN_KEY is not set on this deployment.");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(encoded);
  } catch {
    throw new SecretBoxError("PLAID_TOKEN_KEY is not valid base64.");
  }
  if (bytes.length !== 32) throw new SecretBoxError("PLAID_TOKEN_KEY must be 32 bytes.");
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(plaintext: string): Promise<Sealed> {
  const k = await key();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data));
  return { ciphertext: toBase64(ct), iv: toBase64(iv) };
}

export async function open(box: Sealed): Promise<string> {
  const k = await key();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(box.iv) },
      k,
      fromBase64(box.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretBoxError("The sealed secret could not be opened (wrong key or altered data).");
  }
}
