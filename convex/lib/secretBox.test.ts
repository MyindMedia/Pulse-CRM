import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seal, open, SecretBoxError } from "./secretBox";

/* A Plaid access token is a standing key to a studio's bank feed. It is sealed
   before it touches the database, so a dashboard, export or backup shows only
   ciphertext. These pin the three properties that make that true: it round
   trips, a changed byte is caught, and the wrong key reads nothing. */

const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 200 - i)));
const realKey = process.env.PLAID_TOKEN_KEY;

beforeEach(() => { process.env.PLAID_TOKEN_KEY = KEY_A; });
afterEach(() => {
  if (realKey === undefined) delete process.env.PLAID_TOKEN_KEY;
  else process.env.PLAID_TOKEN_KEY = realKey;
});

describe("secretBox", () => {
  it("round trips and never stores the plaintext", async () => {
    const box = await seal("access-sandbox-abc123");
    expect(box.ciphertext).not.toContain("access-sandbox");
    expect(box.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await open(box)).toBe("access-sandbox-abc123");
  });

  it("uses a fresh IV every time", async () => {
    const a = await seal("same");
    const b = await seal("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects a tampered ciphertext", async () => {
    const box = await seal("access-sandbox-abc123");
    const bytes = Uint8Array.from(atob(box.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = { ...box, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await expect(open(tampered)).rejects.toBeInstanceOf(SecretBoxError);
  });

  it("reads nothing with the wrong key", async () => {
    const box = await seal("access-sandbox-abc123");
    process.env.PLAID_TOKEN_KEY = KEY_B;
    await expect(open(box)).rejects.toBeInstanceOf(SecretBoxError);
  });

  it("refuses to run without a 32-byte key", async () => {
    process.env.PLAID_TOKEN_KEY = btoa("short");
    await expect(seal("x")).rejects.toBeInstanceOf(SecretBoxError);
    delete process.env.PLAID_TOKEN_KEY;
    await expect(seal("x")).rejects.toBeInstanceOf(SecretBoxError);
  });
});
