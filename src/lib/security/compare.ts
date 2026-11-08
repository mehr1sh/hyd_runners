import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets. Both values are hashed with
 * SHA-256 first, so the buffers always have the same length and neither the
 * contents nor the length of the expected secret leaks through timing.
 */
export function safeEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * The token from an `Authorization: Bearer <token>` header, or null when the
 * header is missing, uses another scheme, or is malformed (empty token,
 * whitespace inside the token, extra parts).
 */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer ([\x21-\x7e]+)$/i.exec(header);
  return match ? match[1] : null;
}
