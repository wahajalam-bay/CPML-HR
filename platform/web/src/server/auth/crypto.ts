import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * Password and token primitives.
 *
 * Passwords: Argon2id. Tokens: 256 bits of CSPRNG entropy, stored only as a
 * SHA-256 digest.
 *
 * The asymmetry is deliberate. A password is low-entropy and chosen by a
 * human, so it needs a slow, memory-hard KDF to make offline cracking
 * expensive. A session token is high-entropy and machine-generated, so it
 * cannot be brute-forced and a fast digest is sufficient — using Argon2 there
 * would add ~100ms to every authenticated request for no security gain.
 */

/* -------------------------------------------------------------------------
 * Passwords
 * ---------------------------------------------------------------------- */

// OWASP Password Storage Cheat Sheet, Argon2id baseline. 19 MiB keeps a
// serverless function comfortably inside its memory budget while staying
// costly enough to matter at scale.
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(
  hash: string | null,
  password: string,
): Promise<boolean> {
  // Accounts created by invitation have no password until they set one.
  // Returning early would leak that fact through response timing, so the work
  // is done regardless against a dummy hash.
  if (!hash) {
    await argonVerify(DUMMY_HASH, password).catch(() => false);
    return false;
  }
  try {
    return await argonVerify(hash, password);
  } catch {
    // A malformed hash is a corrupt row, not a valid password.
    return false;
  }
}

/**
 * A real Argon2id hash of a random string, used to keep the "no such user"
 * path as slow as the "wrong password" path. Without it, response time alone
 * enumerates which email addresses have accounts.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$IU0nCxAmiHnJmFXvKKC0eF1TThg2Rn0J4bYBGL8IhQY";

/** Warms the dummy-hash path so the first sign-in is not anomalously fast. */
export async function equaliseTiming(password: string): Promise<void> {
  await argonVerify(DUMMY_HASH, password).catch(() => false);
}

/* -------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------- */

/** 256 bits, URL-safe. Returned to the client exactly once. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What actually gets stored. A database leak alone cannot be replayed. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for any secret compared outside the database. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* -------------------------------------------------------------------------
 * Normalisation
 * ---------------------------------------------------------------------- */

/**
 * Canonical form of an email for uniqueness checks.
 *
 * Case is folded because "A@x.com" and "a@x.com" are the same mailbox, and
 * treating them as two accounts is a duplicate-registration hole. Gmail's dot
 * and plus-tag aliasing is deliberately NOT collapsed: doing so would silently
 * merge addresses that other providers treat as distinct.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
