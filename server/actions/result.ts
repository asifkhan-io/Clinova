import { AuthError, type AuthErrorCode } from "../auth/errors";

/**
 * Every Server Action returns this. `E` is the exact set of error codes, so the
 * UI's t(`errors.${code}`) is type-checked against the message files: a code
 * without a translation is a compile error, not a blank on screen.
 */
export type ActionResult<T = undefined, E extends string = never> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export function authFailure(error: unknown): { ok: false; error: AuthErrorCode } {
  if (error instanceof AuthError) return { ok: false, error: error.code };
  throw error;
}

/** Postgres unique-violation on a named constraint. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const e = cause as { code?: string; constraint?: string };
  return e?.code === "23505" && e?.constraint === constraint;
}
