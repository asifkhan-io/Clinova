import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use secrets (invite links now, appointment links in Phase 5).
 * The raw token goes into the URL once; only its sha256 is stored, so a
 * database dump yields no usable link.
 */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
